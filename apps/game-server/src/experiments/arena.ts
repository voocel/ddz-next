/**
 * 竞技场 headless 竞赛:三个选手（LLM 或规则 bot）按复式赛制批量对打,产出可比较的排名报告。
 *
 * 复式赛制抵消运气:每个 board 用同一 seed 重现同一副牌,三位选手轮转座位各打一次
 * ——你拿这副地主牌打一遍,我也拿同一副打一遍,剩下的差距才是实力。
 * （注:复式只保证首次发牌一致;全员不叫触发的重发牌走同一确定性流,但消耗随各局决策路径而异。）
 *
 * 运行(LLM 席位需 bot-providers.json / ANTHROPIC_API_KEY,产生真实 API 费用):
 *   pnpm --filter @ddz/game-server arena -- --lineup anthropic/claude-haiku-4-5,anthropic/claude-sonnet-4-6,rule --boards 4 --seed match-1
 * 席位写 rule 表示规则 bot(可作零成本基准或 harness 自检):
 *   pnpm --filter @ddz/game-server arena -- --lineup rule,rule,rule --boards 2
 * 其它参数: --concurrency 2(并行对局数)  --out logs/arena/report.json(报告落盘,缺省仅打印)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@ddz/env";
import { GameTable, mulberry32, seedFromString } from "@ddz/domain";
import type { PlayerId, Settlement } from "@ddz/domain";
import {
  buildReasoningProviderOptions,
  decisionConfigFromEnv,
  LlmBidChooser,
  LlmMoveChooser,
  parseBotProviderRegistry,
  resolveModel,
  type ModelRef
} from "@ddz/bot-ai";
import { readBotProvidersRaw } from "../botProviders.js";
import { estimateCostUsd } from "./pricing.js";
import type { BotAction, BotBrain } from "../rooms/botBrain.js";
import { RuleBotBrain } from "../rooms/ruleBotBrain.js";
import { LlmBotBrain, LlmDecisionError, type LlmDecisionMetric } from "../rooms/llmBotBrain.js";
import { createLlmTraceSink } from "../rooms/llmTraceSink.js";

const SEATS: readonly PlayerId[] = ["bot:p0", "bot:p1", "bot:p2"];
const ROTATIONS = 3;
// 安全上限:防极端连续重发牌/异常导致不收敛(正常一局远小于此)。
const MAX_TURNS = 800;
const ELO_INITIAL = 1000;
const ELO_K = 32;

export type LineupEntry = ModelRef | "rule";

export interface ArenaCliOptions {
  readonly lineup: readonly LineupEntry[];
  readonly boards: number;
  readonly seed: string;
  readonly concurrency: number;
  readonly out: string | null;
}

/** 一位选手:身份 + 专属大脑 + 归属到它名下的 LLM 指标。 */
export interface Contestant {
  /** 唯一键(同模型多席位追加 #2/#3),报告与 Elo 以此区分 */
  readonly key: string;
  readonly ref: ModelRef | null;
  readonly brain: BotBrain;
  readonly metrics: LlmDecisionMetric[];
}

interface ContestantGameOutcome {
  readonly key: string;
  readonly seat: PlayerId;
  readonly role: "landlord" | "farmer";
  readonly scoreDelta: number;
  readonly won: boolean;
}

export interface CompletedGame {
  readonly board: number;
  readonly rotation: number;
  readonly landlordKey: string;
  readonly landlordWon: boolean;
  readonly outcomes: readonly ContestantGameOutcome[];
}

export interface AbortedGame {
  readonly board: number;
  readonly rotation: number;
  /** 抛错选手(技术负归属);非决策异常时为 null */
  readonly contestant: string | null;
  readonly reason: string;
  readonly message: string;
}

export interface TournamentResult {
  readonly completed: readonly CompletedGame[];
  readonly aborted: readonly AbortedGame[];
}

/** 解析 --lineup:逗号分隔的三席,每席为 provider/model(model 可含斜杠)或字面量 rule。 */
export function parseLineup(raw: string): readonly LineupEntry[] {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error(`--lineup 需要恰好 3 个逗号分隔的席位,收到: "${raw}"`);
  }
  return parts.map((part) => {
    if (part === "rule") {
      return "rule";
    }
    const slash = part.indexOf("/");
    if (slash <= 0 || slash === part.length - 1) {
      throw new Error(`席位 "${part}" 不合法:应为 provider/model 或 rule`);
    }
    return { provider: part.slice(0, slash), model: part.slice(slash + 1) };
  });
}

/** 选手唯一键:同名条目追加 #2/#3(同模型左右互搏时各自独立计分)。 */
export function contestantKeys(lineup: readonly LineupEntry[]): readonly string[] {
  const seen = new Map<string, number>();
  return lineup.map((entry) => {
    const base = entry === "rule" ? "rule" : `${entry.provider}/${entry.model}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

/** 轮转 rotation 下选手 index 的座位:0..2 号选手依次顺移,保证每人每 board 各坐三席一次。 */
export function seatForContestant(contestantIndex: number, rotation: number): PlayerId {
  return SEATS[(contestantIndex + rotation) % 3]!;
}

/**
 * Elo(K=32,初始 1000):地主与两位农民各记一场对局,农民同队不互算。
 * 按 board/rotation 顺序逐局折算,选手键相同(同模型互搏)时增减自然抵消。
 */
export function computeElo(games: readonly CompletedGame[], keys: readonly string[]): Record<string, number> {
  const ratings: Record<string, number> = Object.fromEntries(keys.map((key) => [key, ELO_INITIAL]));
  const ordered = [...games].sort((a, b) => a.board - b.board || a.rotation - b.rotation);
  for (const game of ordered) {
    const farmers = game.outcomes.filter((outcome) => outcome.role === "farmer");
    for (const farmer of farmers) {
      const landlordRating = ratings[game.landlordKey]!;
      const farmerRating = ratings[farmer.key]!;
      const expected = 1 / (1 + 10 ** ((farmerRating - landlordRating) / 400));
      const actual = game.landlordWon ? 1 : 0;
      ratings[game.landlordKey] = ratings[game.landlordKey]! + ELO_K * (actual - expected);
      ratings[farmer.key] = ratings[farmer.key]! + ELO_K * (expected - actual);
    }
  }
  return ratings;
}

interface ArenaGameError {
  readonly playerId: PlayerId;
  readonly cause: unknown;
}

function isArenaGameError(error: unknown): error is ArenaGameError {
  return Boolean(error) && typeof error === "object" && "playerId" in (error as object) && "cause" in (error as object);
}

async function playGame(table: GameTable, brains: ReadonlyMap<PlayerId, BotBrain>): Promise<Settlement> {
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
    let action: BotAction;
    try {
      action = await brains.get(pid)!.decide(snap, pid, table.getHand(pid), table.playedCards(), table.history());
    } catch (cause) {
      // 记下抛错席位:上层据此把技术负归属到该选手
      throw { playerId: pid, cause } satisfies ArenaGameError;
    }
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

/** 简单信号量:并行跑对局但限制在飞数量(每局内部是串行 LLM 调用,飞行局数≈并发请求数)。 */
async function runLimited(tasks: ReadonlyArray<() => Promise<void>>, limit: number): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      await task();
    }
  });
  await Promise.all(workers);
}

/**
 * 跑完整赛程:boards × 3 轮转。每 board 以 seedFromString(`${seed}#${board}`) 重现同一副牌,
 * LLM 抛错该局作废并记技术负,不影响其余对局。
 */
export async function runTournament(
  contestants: readonly Contestant[],
  options: { readonly boards: number; readonly seed: string; readonly concurrency: number },
  onGameDone?: (done: number, total: number) => void
): Promise<TournamentResult> {
  const completed: CompletedGame[] = [];
  const aborted: AbortedGame[] = [];
  const total = options.boards * ROTATIONS;
  let done = 0;

  const tasks: Array<() => Promise<void>> = [];
  for (let board = 0; board < options.boards; board += 1) {
    for (let rotation = 0; rotation < ROTATIONS; rotation += 1) {
      tasks.push(async () => {
        const table = new GameTable(mulberry32(seedFromString(`${options.seed}#${board}`)));
        const seatToContestant = new Map<PlayerId, Contestant>(
          contestants.map((contestant, index) => [seatForContestant(index, rotation), contestant])
        );
        const brains = new Map<PlayerId, BotBrain>(
          [...seatToContestant].map(([seat, contestant]) => [seat, contestant.brain])
        );
        try {
          const settlement = await playGame(table, brains);
          completed.push(toCompletedGame(board, rotation, settlement, seatToContestant));
        } catch (error) {
          aborted.push(toAbortedGame(board, rotation, error, seatToContestant));
        } finally {
          done += 1;
          onGameDone?.(done, total);
        }
      });
    }
  }

  await runLimited(tasks, options.concurrency);
  return { completed, aborted };
}

function toCompletedGame(
  board: number,
  rotation: number,
  settlement: Settlement,
  seatToContestant: ReadonlyMap<PlayerId, Contestant>
): CompletedGame {
  const outcomes = settlement.players.map((player) => {
    const contestant = seatToContestant.get(player.playerId)!;
    return {
      key: contestant.key,
      seat: player.playerId,
      role: player.role,
      scoreDelta: player.scoreDelta,
      won: settlement.landlordWon === (player.role === "landlord")
    };
  });
  return {
    board,
    rotation,
    landlordKey: outcomes.find((outcome) => outcome.role === "landlord")!.key,
    landlordWon: settlement.landlordWon,
    outcomes
  };
}

function toAbortedGame(
  board: number,
  rotation: number,
  error: unknown,
  seatToContestant: ReadonlyMap<PlayerId, Contestant>
): AbortedGame {
  if (isArenaGameError(error)) {
    const culprit = seatToContestant.get(error.playerId);
    const reason = error.cause instanceof LlmDecisionError ? error.cause.reason : "exception";
    const message = error.cause instanceof Error ? error.cause.message : String(error.cause);
    return { board, rotation, contestant: culprit?.key ?? null, reason, message };
  }
  return {
    board,
    rotation,
    contestant: null,
    reason: "exception",
    message: error instanceof Error ? error.message : String(error)
  };
}

interface ContestantReport {
  readonly key: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly games: number;
  readonly wins: number;
  readonly winRate: number | null;
  readonly landlordGames: number;
  readonly landlordWins: number;
  readonly farmerGames: number;
  readonly farmerWins: number;
  readonly totalScore: number;
  readonly elo: number;
  readonly aborts: number;
  readonly llm: {
    readonly decisions: number;
    readonly avgLatencyMs: number;
    readonly maxLatencyMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estCostUsd: number | null;
  } | null;
}

export interface ArenaReport {
  readonly config: {
    readonly lineup: readonly string[];
    readonly boards: number;
    readonly rotations: number;
    readonly seed: string;
    readonly concurrency: number;
  };
  readonly games: { readonly total: number; readonly completed: number; readonly aborted: number };
  readonly contestants: readonly ContestantReport[];
  /** 头对头胜率矩阵:matrix[a][b] = a 以对手身份(地主 vs 农民)战胜 b 的场次/交手数;农民同队不计。 */
  readonly matrix: Record<string, Record<string, { wins: number; games: number }>>;
  readonly aborted: readonly AbortedGame[];
  readonly durationMs: number;
}

export function buildReport(
  contestants: readonly Contestant[],
  options: ArenaCliOptions,
  result: TournamentResult,
  durationMs: number
): ArenaReport {
  const keys = contestants.map((contestant) => contestant.key);
  const elo = computeElo(result.completed, keys);
  const matrix: Record<string, Record<string, { wins: number; games: number }>> = {};
  const stats = new Map(
    keys.map((key) => [
      key,
      { games: 0, wins: 0, landlordGames: 0, landlordWins: 0, farmerGames: 0, farmerWins: 0, totalScore: 0 }
    ])
  );

  for (const game of result.completed) {
    const farmers = game.outcomes.filter((outcome) => outcome.role === "farmer");
    for (const outcome of game.outcomes) {
      const stat = stats.get(outcome.key)!;
      stat.games += 1;
      stat.wins += outcome.won ? 1 : 0;
      stat.totalScore += outcome.scoreDelta;
      if (outcome.role === "landlord") {
        stat.landlordGames += 1;
        stat.landlordWins += outcome.won ? 1 : 0;
      } else {
        stat.farmerGames += 1;
        stat.farmerWins += outcome.won ? 1 : 0;
      }
    }
    for (const farmer of farmers) {
      recordHeadToHead(matrix, game.landlordKey, farmer.key, game.landlordWon);
      recordHeadToHead(matrix, farmer.key, game.landlordKey, !game.landlordWon);
    }
  }

  const contestantReports = contestants.map((contestant): ContestantReport => {
    const stat = stats.get(contestant.key)!;
    const latencies = contestant.metrics.map((metric) => metric.latencyMs);
    const inputTokens = contestant.metrics.reduce((sum, metric) => sum + (metric.usage?.inputTokens ?? 0), 0);
    const outputTokens = contestant.metrics.reduce((sum, metric) => sum + (metric.usage?.outputTokens ?? 0), 0);
    return {
      key: contestant.key,
      provider: contestant.ref?.provider ?? null,
      model: contestant.ref?.model ?? null,
      ...stat,
      winRate: stat.games ? stat.wins / stat.games : null,
      elo: Math.round(elo[contestant.key]!),
      aborts: result.aborted.filter((game) => game.contestant === contestant.key).length,
      llm: contestant.ref
        ? {
            decisions: contestant.metrics.length,
            avgLatencyMs: latencies.length
              ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
              : 0,
            maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
            inputTokens,
            outputTokens,
            estCostUsd: contestant.ref ? estimateCostUsd(contestant.ref.model, inputTokens, outputTokens) : null
          }
        : null
    };
  });

  return {
    config: {
      lineup: keys,
      boards: options.boards,
      rotations: ROTATIONS,
      seed: options.seed,
      concurrency: options.concurrency
    },
    games: {
      total: options.boards * ROTATIONS,
      completed: result.completed.length,
      aborted: result.aborted.length
    },
    contestants: [...contestantReports].sort((a, b) => b.elo - a.elo),
    matrix,
    aborted: result.aborted,
    durationMs
  };
}

function recordHeadToHead(
  matrix: Record<string, Record<string, { wins: number; games: number }>>,
  from: string,
  to: string,
  won: boolean
): void {
  const row = (matrix[from] ??= {});
  const cell = (row[to] ??= { wins: 0, games: 0 });
  cell.games += 1;
  cell.wins += won ? 1 : 0;
}

export function parseArenaArgs(argv: readonly string[]): ArenaCliOptions {
  let lineupRaw: string | null = null;
  let boards = 4;
  let seed = "arena";
  let concurrency = 2;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--lineup") {
      lineupRaw = argv[++i] ?? null;
    } else if (arg === "--boards") {
      boards = Math.max(1, Number(argv[++i]) || boards);
    } else if (arg === "--seed") {
      seed = argv[++i] ?? seed;
    } else if (arg === "--concurrency") {
      concurrency = Math.max(1, Number(argv[++i]) || concurrency);
    } else if (arg === "--out") {
      out = argv[++i] ?? null;
    }
  }
  if (!lineupRaw) {
    throw new Error("必须提供 --lineup,如 --lineup anthropic/claude-haiku-4-5,rule,rule");
  }
  return { lineup: parseLineup(lineupRaw), boards, seed, concurrency, out };
}

/** 装配选手:rule 席位用规则大脑;LLM 席位从注册表解析模型,缺配置直接报错(不静默降级)。 */
function buildContestants(options: ArenaCliOptions, traceSink: ReturnType<typeof createLlmTraceSink>): Contestant[] {
  const keys = contestantKeys(options.lineup);
  const llmRefs = options.lineup.filter((entry): entry is ModelRef => entry !== "rule");
  const configRaw = readBotProvidersRaw();
  // 无 bot-providers.json 时向后兼容 selfPlay 的旧用法:全 anthropic 阵容可直接用 ANTHROPIC_API_KEY
  const registry = llmRefs.length
    ? parseBotProviderRegistry(
        configRaw ??
          JSON.stringify({
            provider: "anthropic",
            model: llmRefs[0]!.model,
            providers: { anthropic: { type: "anthropic", models: llmRefs.map((ref) => ref.model) } }
          })
      )
    : null;
  const reasoningEffort = decisionConfigFromEnv().reasoningEffort;

  return options.lineup.map((entry, index) => {
    const key = keys[index]!;
    if (entry === "rule") {
      return { key, ref: null, brain: new RuleBotBrain(), metrics: [] };
    }
    const model = registry ? resolveModel(entry, registry, { reasoningEffort }) : null;
    const provider = registry?.providers[entry.provider];
    if (!model || !provider) {
      throw new Error(
        `未能解析模型 ${key}:请在 bot-providers.json / BOT_PROVIDERS 配置该 provider 与 API key(anthropic 也可用 ANTHROPIC_API_KEY + 内置模型名)。`
      );
    }
    const metrics: LlmDecisionMetric[] = [];
    const chooserOptions = {
      model,
      providerOptions: buildReasoningProviderOptions(provider.type, entry.provider, reasoningEffort),
      provider: { key: entry.provider, type: provider.type, baseURL: provider.baseURL }
    };
    return {
      key,
      ref: entry,
      brain: new LlmBotBrain({
        chooser: new LlmMoveChooser(chooserOptions),
        bidChooser: new LlmBidChooser(chooserOptions),
        onDecision: (metric) => metrics.push(metric),
        onTrace: (trace) => traceSink.record(trace)
      }),
      metrics
    };
  });
}

function pct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function printSummary(report: ArenaReport): void {
  console.log(
    `\n赛果:${report.games.completed}/${report.games.total} 局完成` +
      (report.games.aborted ? `,${report.games.aborted} 局流局(技术负见 aborted)` : "")
  );
  for (const [rank, contestant] of report.contestants.entries()) {
    const llm = contestant.llm;
    console.log(
      `#${rank + 1} ${contestant.key}  Elo ${contestant.elo}  胜率 ${pct(contestant.winRate)} (${contestant.wins}/${contestant.games})` +
        `  地主 ${contestant.landlordWins}/${contestant.landlordGames}  农民 ${contestant.farmerWins}/${contestant.farmerGames}` +
        `  累计分 ${contestant.totalScore}` +
        (llm
          ? `  [${llm.decisions} 手,均延迟 ${llm.avgLatencyMs}ms,成本 ${llm.estCostUsd === null ? "?" : `$${llm.estCostUsd.toFixed(4)}`}]`
          : "") +
        (contestant.aborts ? `  ⚠️ 技术负 ${contestant.aborts}` : "")
    );
  }
}

async function main(): Promise<void> {
  // 独立入口,需自行加载根 .env(线上 game-server 由 index.ts 负责);环境变量优先于 .env。
  loadRootEnv();
  const options = parseArenaArgs(process.argv.slice(2));
  const traceSink = createLlmTraceSink(process.env, `arena-${options.seed}`);
  const contestants = buildContestants(options, traceSink);
  const keys = contestants.map((contestant) => contestant.key);
  console.log(
    `竞技场复式赛:${options.boards} 副牌 × ${ROTATIONS} 轮转 = ${options.boards * ROTATIONS} 局,seed=${options.seed},并发 ${options.concurrency}`
  );
  console.log(`选手: ${keys.join("  vs  ")}\n`);

  const startedAt = Date.now();
  const result = await runTournament(contestants, options, (done, total) => {
    process.stdout.write(`\r进度 ${done}/${total}`);
  });
  process.stdout.write("\n");
  await traceSink.close();

  const report = buildReport(contestants, options, result, Date.now() - startedAt);
  printSummary(report);

  const json = JSON.stringify(report, null, 2);
  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, json, "utf8");
    console.log(`\n完整报告已写入 ${options.out}`);
  } else {
    console.log(`\n${json}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
