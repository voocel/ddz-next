/**
 * 自博弈 A/B 实验:用 @ddz/domain 的 GameTable 直接驱动三机器人对打 N 局,
 * 对比「焦点座位 p0 用规则 bot」(对照)与「p0 用 LLM bot」(实验)的胜率,
 * 并采集 LLM 的回退率、决策延迟、token 成本。用数据回答「这个模型真会打斗地主吗」。
 *
 * 运行(需 ANTHROPIC_API_KEY,会产生真实 API 费用):
 *   pnpm --filter @ddz/game-server selfplay -- --games 30 --model claude-haiku-4-5
 * 仅跑规则对照(零成本,自检 harness):
 *   pnpm --filter @ddz/game-server selfplay -- --games 50 --skip-llm
 */
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@ddz/env";
import { GameTable } from "@ddz/domain";
import type { PlayerId, Settlement } from "@ddz/domain";
import { LlmMoveChooser, parseBotProviderRegistry, resolveModel, type ModelRef } from "@ddz/bot-ai";
import { readBotProvidersRaw } from "../botProviders.js";
import type { BotAction, BotBrain } from "../rooms/botBrain.js";
import { RuleBotBrain } from "../rooms/ruleBotBrain.js";
import { LlmBotBrain, LlmDecisionError, type LlmDecisionMetric } from "../rooms/llmBotBrain.js";
import { createLlmTraceSink } from "../rooms/llmTraceSink.js";

/** 一局因 LLM 抛错中断的记录(有错就暴露,不偷偷续局)。 */
interface GameError {
  readonly game: number;
  readonly reason: string;
  readonly message: string;
}

const SEATS: readonly PlayerId[] = ["bot:p0", "bot:p1", "bot:p2"];
const FOCUS_SEAT: PlayerId = "bot:p0";
// 安全上限:防极端连续重发牌/异常导致不收敛(正常一局远小于此)。
const MAX_TURNS = 800;

// 模型计价($/百万 token):input / output。未知模型只报 token、不估成本。
const PRICING: Record<string, readonly [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-fable-5": [10, 50]
};

interface CliOptions {
  readonly games: number;
  readonly provider: string;
  readonly model: string;
  readonly skipLlm: boolean;
}

interface SeatStats {
  games: number;
  wins: number;
  landlordGames: number;
  landlordWins: number;
  farmerGames: number;
  farmerWins: number;
}

function emptyStats(): SeatStats {
  return { games: 0, wins: 0, landlordGames: 0, landlordWins: 0, farmerGames: 0, farmerWins: 0 };
}

function seatWon(seat: PlayerId, settlement: Settlement): boolean {
  return settlement.landlordWon ? seat === settlement.landlordId : seat !== settlement.landlordId;
}

function record(stats: SeatStats, seat: PlayerId, settlement: Settlement): void {
  const isLandlord = seat === settlement.landlordId;
  const won = seatWon(seat, settlement);
  stats.games += 1;
  stats.wins += won ? 1 : 0;
  if (isLandlord) {
    stats.landlordGames += 1;
    stats.landlordWins += won ? 1 : 0;
  } else {
    stats.farmerGames += 1;
    stats.farmerWins += won ? 1 : 0;
  }
}

async function playGame(brains: Record<PlayerId, BotBrain>): Promise<Settlement> {
  const table = new GameTable();
  for (const id of SEATS) {
    table.addBot(id);
  }
  for (const id of SEATS) {
    table.setReady(id);
  }

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const snap = table.snapshot();
    if (snap.phase === "settled") {
      if (!snap.settlement) {
        throw new Error("settled without settlement");
      }
      return snap.settlement;
    }
    const pid = snap.currentPlayerId;
    if (!pid) {
      throw new Error(`no current player in phase ${snap.phase}`);
    }
    const action = await brains[pid]!.decide(snap, pid, table.getHand(pid), table.playedCards());
    applyAction(table, pid, action);
  }
  throw new Error("game did not settle within turn cap");
}

function applyAction(table: GameTable, pid: PlayerId, action: BotAction): void {
  switch (action.type) {
    case "bid_landlord":
      table.bidLandlord(pid, action.called);
      return;
    case "rob_landlord":
      table.robLandlord(pid, action.robbed);
      return;
    case "pass":
      table.pass(pid);
      return;
    case "play_cards":
      table.playCards(pid, action.cards);
      return;
  }
}

async function runArm(
  label: string,
  games: number,
  brainFor: (seat: PlayerId) => BotBrain,
  onError?: (game: number, error: unknown) => void
): Promise<SeatStats> {
  const brains = Object.fromEntries(SEATS.map((seat) => [seat, brainFor(seat)])) as Record<PlayerId, BotBrain>;
  const stats = emptyStats();
  for (let i = 0; i < games; i += 1) {
    try {
      const settlement = await playGame(brains);
      record(stats, FOCUS_SEAT, settlement);
    } catch (error) {
      // 无 onError(对照臂规则 bot 不该抛)就冒泡;LLM 臂把失败如实记下、该局作废、继续。
      if (!onError) {
        throw error;
      }
      onError(i + 1, error);
    }
    process.stdout.write(`\r[${label}] ${i + 1}/${games}`);
  }
  process.stdout.write("\n");
  return stats;
}

function summarizeMetrics(metrics: readonly LlmDecisionMetric[], errors: readonly GameError[], model: string): string {
  if (metrics.length === 0 && errors.length === 0) {
    return "无 LLM 决策记录。";
  }
  const latencies = metrics.map((m) => m.latencyMs);
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const maxLatency = latencies.length ? Math.max(...latencies) : 0;
  const inputTokens = metrics.reduce((sum, m) => sum + (m.usage?.inputTokens ?? 0), 0);
  const outputTokens = metrics.reduce((sum, m) => sum + (m.usage?.outputTokens ?? 0), 0);
  const price = PRICING[model];
  const cost = price ? (inputTokens / 1e6) * price[0] + (outputTokens / 1e6) * price[1] : null;

  const lines = [
    `LLM 成功决策: ${metrics.length}  延迟: 平均 ${avgLatency.toFixed(0)}ms  最大 ${maxLatency}ms`,
    `Token: 输入 ${inputTokens}  输出 ${outputTokens}  估算成本: ${cost === null ? "未知模型,不估" : `$${cost.toFixed(4)}`}`
  ];
  if (errors.length === 0) {
    lines.push("无失败局:LLM 全程未抛错。");
  } else {
    const byReason: Record<string, number> = {};
    for (const e of errors) {
      byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    }
    lines.push(`⚠️  LLM 失败中断 ${errors.length} 局,按原因: ${JSON.stringify(byReason)}`);
    lines.push(`    首例: 第 ${errors[0]!.game} 局 — ${errors[0]!.message}`);
  }
  return lines.join("\n");
}

function pct(part: number, total: number): string {
  return total === 0 ? "-" : `${((part / total) * 100).toFixed(1)}%`;
}

function reportSeat(label: string, stats: SeatStats): string {
  return [
    `${label} — ${FOCUS_SEAT} 总胜率: ${pct(stats.wins, stats.games)} (${stats.wins}/${stats.games})`,
    `  地主胜率: ${pct(stats.landlordWins, stats.landlordGames)} (${stats.landlordWins}/${stats.landlordGames})` +
      `   农民胜率: ${pct(stats.farmerWins, stats.farmerGames)} (${stats.farmerWins}/${stats.farmerGames})`
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  let games = 20;
  let provider = "anthropic";
  let model = "claude-haiku-4-5";
  let skipLlm = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--games") {
      games = Math.max(1, Number(argv[++i]) || games);
    } else if (arg === "--provider") {
      provider = argv[++i] ?? provider;
    } else if (arg === "--model") {
      model = argv[++i] ?? model;
    } else if (arg === "--skip-llm") {
      skipLlm = true;
    }
  }
  return { games, provider, model, skipLlm };
}

/**
 * 造自博弈用的注册表 + 目标模型 ref:有 bot-providers.json 用之(支持任意 provider);
 * 否则合成仅含目标模型的 anthropic 注册表,沿用 ANTHROPIC_API_KEY(向后兼容旧用法)。
 */
function buildModel(options: CliOptions): ReturnType<typeof resolveModel> {
  const configRaw = readBotProvidersRaw();
  if (configRaw) {
    const registry = parseBotProviderRegistry(configRaw);
    const ref: ModelRef = { provider: options.provider, model: options.model };
    return resolveModel(ref, registry);
  }
  const synthesized = parseBotProviderRegistry(
    JSON.stringify({
      provider: "anthropic",
      model: options.model,
      providers: { anthropic: { type: "anthropic", models: [options.model] } }
    })
  );
  return resolveModel({ provider: "anthropic", model: options.model }, synthesized);
}

async function main(): Promise<void> {
  // 独立入口,需自行加载根 .env(线上 game-server 由 index.ts 负责);环境变量优先于 .env。
  loadRootEnv();
  const options = parseArgs(process.argv.slice(2));
  console.log(`自博弈 A/B:每臂 ${options.games} 局,焦点座位 ${FOCUS_SEAT}\n`);

  const control = await runArm("control", options.games, () => new RuleBotBrain());
  console.log(reportSeat("对照(p0=规则)", control));

  if (options.skipLlm) {
    console.log("\n已跳过 LLM 臂(--skip-llm)。");
    return;
  }
  // 配置缺失就明确报错退出,不静默回退——目的是验证 LLM,缺 key 没法验证。
  const model = buildModel(options);
  if (!model) {
    console.error(`\n❌ 未能解析模型 ${options.provider}/${options.model}:缺 API key(openai-compatible 还需 base_url)。`);
    console.error("   请在 bot-providers.json / BOT_PROVIDERS 配置;anthropic 也可用 ANTHROPIC_API_KEY + 内置模型名。已跳过 LLM 臂。");
    process.exitCode = 1;
    return;
  }

  const metrics: LlmDecisionMetric[] = [];
  const errors: GameError[] = [];
  // BOT_DECISION_TRACE=true 时把每手 LLM 决策逐条留证落 JSONL,供离线复盘(同生产用一套 sink)。
  const traceSink = createLlmTraceSink(process.env, `selfplay-${options.provider}-${options.model}`);
  const llmBrain = new LlmBotBrain({
    chooser: new LlmMoveChooser({ model }),
    onDecision: (m) => metrics.push(m),
    onTrace: traceSink ? (trace) => traceSink.record(trace) : undefined
  });
  const treatment = await runArm(
    "llm",
    options.games,
    (seat) => (seat === FOCUS_SEAT ? llmBrain : new RuleBotBrain()),
    (game, error) => {
      const reason = error instanceof LlmDecisionError ? error.reason : "exception";
      errors.push({ game, reason, message: error instanceof Error ? error.message : String(error) });
    }
  );
  await traceSink?.close();
  if (traceSink) {
    console.log("\n📝 每手 LLM 决策留证已写入 logs/llm-traces/(BOT_DECISION_TRACE=true)。");
  }

  console.log(`\n${reportSeat(`实验(p0=LLM ${options.provider}/${options.model})`, treatment)}`);
  console.log(`\n${summarizeMetrics(metrics, errors, options.model)}`);

  const completed = treatment.games;
  if (completed === 0) {
    console.log("\n所有 LLM 局均失败中断,无有效胜率(见上方失败原因)。");
    return;
  }
  const delta = treatment.wins / completed - control.wins / Math.max(1, control.games);
  console.log(
    `\n胜率差(实验-对照): ${(delta * 100).toFixed(1)} 个百分点 ${delta >= 0 ? "(LLM 不弱于规则)" : "(LLM 弱于规则)"}` +
      (errors.length ? `  [注:实验臂 ${completed}/${options.games} 局完成,${errors.length} 局因 LLM 失败作废]` : "")
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
