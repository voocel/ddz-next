import { compareRank, enumerateLegalMoves } from "@ddz/domain";
import type { Card, Combination, GameSnapshot, LegalMove, PlayerId, Rank } from "@ddz/domain";
import type {
  ChooserTrace,
  MoveChooser,
  MoveDecision,
  MoveSelectionContext,
  MoveStreamDelta,
  MoveStreamHooks,
  ProviderRequestSummary,
  TokenUsage
} from "@ddz/bot-ai";
import type { BotAction, BotBrain } from "./botBrain.js";
import { RuleBotBrain } from "./ruleBotBrain.js";
import { describeCombination, rankLabel } from "./combinationLabels.js";

/** 一次成功 LLM 出牌决策的可观测指标(失败不再回退,而是抛错,故无 fallback 记录)。 */
export interface LlmDecisionMetric {
  readonly latencyMs: number;
  readonly usage: TokenUsage | null;
}

/** LLM 成功解析出的候选选择:编号来自模型输出,label 是当手候选列表中该编号对应的具体动作。 */
export interface LlmDecisionChoice {
  readonly index: number;
  readonly label: string;
}

/** 一次 LLM 出牌决策的结局(四选一);ok 才有动作。 */
export type LlmDecisionOutcome =
  | { readonly kind: "ok"; readonly index: number; readonly action: BotAction }
  | { readonly kind: "no_choice" }
  | { readonly kind: "invalid_index"; readonly index: number }
  | { readonly kind: "error"; readonly message: string };

/**
 * 一次出牌决策的完整留证:游戏上下文 + 该 bot 完整手牌 + 模型 IO/思考 + 用量 + 延迟 + 结局。
 * 仅服务端落盘(JSONL),供逐手排错/优化;不含密钥。四种结局每种都会产出一条。
 */
export interface LlmDecisionTrace {
  readonly playerId: PlayerId;
  readonly role: "landlord" | "farmer";
  readonly selfHand: readonly string[];
  readonly selfHandCount: number;
  readonly opponentHandCounts: readonly number[];
  readonly lastPlay: string | null;
  /** 本局已出的牌(分组计数),与喂给模型的口径一致,供离线分析「信息量 ↔ 牌力」。 */
  readonly playedCards: readonly string[];
  readonly candidates: readonly string[];
  readonly modelId: string | null;
  readonly system: string | null;
  readonly prompt: string | null;
  readonly rawText: string | null;
  readonly reasoningText: string | null;
  readonly finishReason: string | null;
  readonly usage: TokenUsage | null;
  readonly requestSummary: ProviderRequestSummary | null;
  readonly latencyMs: number;
  readonly outcome: LlmDecisionOutcome;
}

/**
 * LLM 出牌决策失败:请求出错(abort/API/网络)、无有效返回(解析失败)或越界。
 * 决策机器人不再静默回退规则 bot——目的是实验验证 LLM 真实表现,有错就暴露。
 */
export class LlmDecisionError extends Error {
  constructor(
    readonly reason: "no_choice" | "invalid_index" | "request_error",
    message: string,
    readonly latencyMs: number
  ) {
    super(message);
    this.name = "LlmDecisionError";
  }
}

export interface LlmBotBrainOptions {
  readonly chooser: MoveChooser;
  /**
   * 叫/抢地主相位的固定策略(LLM 只决策出牌,隔离实验变量),默认规则 bot。
   * 这不是失败兜底——出牌相位失败一律抛错暴露,绝不回退。
   * TODO(等 LLM 出牌跑稳后): 叫/抢也改用 LLM、移除本字段,让两种 bot 零交集(见 tasks/todo.md)。
   */
  readonly bidStrategy?: BotBrain;
  readonly onDecision?: ((metric: LlmDecisionMetric) => void) | undefined;
  /** 每次 LLM 出牌决策(成功/no_choice/越界/请求出错)都回调一次完整留证,供落盘排错;不设则不记。 */
  readonly onTrace?: ((trace: LlmDecisionTrace) => void) | undefined;
  /** 出牌决策正式发起 LLM 请求前回调一次,供上层清理上一手面板并显示“准备分析”。 */
  readonly onStreamStart?: ((playerId: PlayerId) => void) | undefined;
  /** 出牌决策过程中实时回调模型输出增量(playerId + channel + 片段),供上层做牌桌「AI 输出流」;不设则不回调。 */
  readonly onStreamDelta?: ((playerId: PlayerId, delta: MoveStreamDelta) => void) | undefined;
  /** 模型最终编号合法后回调其对应候选动作,供上层把「1」展示成「单张4」等具体结果。 */
  readonly onChoice?: ((playerId: PlayerId, choice: LlmDecisionChoice) => void) | undefined;
  /** 可注入时钟,便于测试测延迟;默认 Date.now。 */
  readonly now?: () => number;
}

/**
 * LLM 决策机器人:只在出牌相位用大模型,叫/抢地主用固定策略(隔离实验变量)。
 * 候选走法由 @ddz/domain 枚举给出,模型只能在其中选——天然杜绝非法出牌;
 * 但任何 null/越界/超时/缺 key 都直接抛错暴露(不回退),让实验能看到模型的真实失败。
 * 决策一律在串行锁外执行(见 BotBrain 契约);线上抛错由房间 onFailure 收口(故障关房 + 日志)。
 */
export class LlmBotBrain implements BotBrain {
  private readonly bidStrategy: BotBrain;
  private readonly now: () => number;

  constructor(private readonly options: LlmBotBrainOptions) {
    this.bidStrategy = options.bidStrategy ?? new RuleBotBrain();
    this.now = options.now ?? Date.now;
  }

  async decide(
    snapshot: GameSnapshot,
    playerId: PlayerId,
    hand: readonly Card[],
    playedCards: readonly Card[]
  ): Promise<BotAction> {
    // 叫/抢地主:用固定策略,隔离实验变量(只验证 LLM 的出牌能力)。
    if (snapshot.phase !== "playing") {
      return this.bidStrategy.decide(snapshot, playerId, hand, playedCards);
    }

    const previous: Combination | null = snapshot.lastPlay?.combination ?? null;
    const legal = enumerateLegalMoves(hand, previous);

    // 跟牌且压不动:唯一合法动作是过牌,无需调用 LLM(这是规则,不是回退)。
    if (previous && legal.length === 0) {
      return { type: "pass" };
    }

    const canPass = previous !== null;
    const labels = buildLabels(legal, canPass);

    // 唯一合法动作(领出且只剩一手能出,典型是最后一张牌):被强制、零决策空间,直接出。
    // 与上面「压不动只能过牌」同理是规则而非回退;且能避免为一个没得选的 move 付出整次 LLM 延迟/失败风险
    // (实测前沿推理模型会在最后一张牌上空想几十秒甚至超时)。labels===1 时必为领出(canPass 时至少含过牌, 长度≥2)。
    if (labels.length === 1) {
      const forced = toAction(0, canPass, legal);
      if (forced) {
        return forced;
      }
    }

    const context = buildContext(snapshot, playerId, hand, playedCards, previous, labels);
    this.options.onStreamStart?.(playerId);
    // AI 输出流:把模型 reasoning/text 增量带上 playerId 转给上层(只在 LLM 出牌路径产生,叫抢/强制出牌不产生)。
    const onStreamDelta = this.options.onStreamDelta;
    const streamHooks: MoveStreamHooks | undefined = onStreamDelta
      ? { onDelta: (delta) => onStreamDelta(playerId, delta) }
      : undefined;
    const start = this.now();
    let decision: MoveDecision | null;
    try {
      decision = await this.options.chooser.choose(context, streamHooks);
    } catch (error) {
      // 真实 chooser 会把 API/abort 错误捕获进 trace.error;走到这里说明是自定义 chooser 直接抛——
      // 尽力记一条 error 留证后原样冒泡(暴露真因)。
      const message = error instanceof Error ? error.message : String(error);
      this.emitTrace(context, hand, playerId, null, this.now() - start, { kind: "error", message });
      throw error;
    }
    const latencyMs = this.now() - start;

    // decision 为 null 仅当「没发请求」(model 为 null / 无候选);无 trace 可记,直接抛错暴露。
    if (!decision) {
      throw new LlmDecisionError("no_choice", `LLM 未发起决策请求;候选 ${labels.length} 项`, latencyMs);
    }
    const trace = decision.trace;

    // 1) 请求出错(abort/超时/API/网络):chooser 已捕获进 trace.error,记证后抛错暴露(不静默)。
    if (trace.error !== null) {
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "error", message: trace.error });
      throw new LlmDecisionError("request_error", `LLM 请求失败: ${trace.error}(候选 ${labels.length} 项)`, latencyMs);
    }
    // 2) 模型有响应但解析不出有效编号。
    if (decision.index === null) {
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "no_choice" });
      throw new LlmDecisionError(
        "no_choice",
        `LLM 未给出有效出牌选择(回复中无法解析出有效编号或越界);候选 ${labels.length} 项`,
        latencyMs
      );
    }
    // 3) 编号越界。
    const action = toAction(decision.index, canPass, legal);
    if (!action) {
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "invalid_index", index: decision.index });
      throw new LlmDecisionError(
        "invalid_index",
        `LLM 返回越界选择 index=${decision.index}(候选 ${labels.length} 项)`,
        latencyMs
      );
    }
    const label = labels[decision.index];
    if (!label) {
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "invalid_index", index: decision.index });
      throw new LlmDecisionError(
        "invalid_index",
        `LLM 返回越界选择 index=${decision.index}(候选 ${labels.length} 项)`,
        latencyMs
      );
    }
    // 4) 成功。
    this.options.onChoice?.(playerId, { index: decision.index, label });
    this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "ok", index: decision.index, action });
    this.options.onDecision?.({ latencyMs, usage: trace.usage });
    return action;
  }

  /** 把游戏上下文 + 该 bot 手牌 + chooser 留证 + 结局拼成一条完整 trace 交给 onTrace(未设则跳过)。 */
  private emitTrace(
    context: MoveSelectionContext,
    hand: readonly Card[],
    playerId: PlayerId,
    trace: ChooserTrace | null,
    latencyMs: number,
    outcome: LlmDecisionOutcome
  ): void {
    if (!this.options.onTrace) {
      return;
    }
    this.options.onTrace({
      playerId,
      role: context.role,
      selfHand: hand.map((card) => card.id),
      selfHandCount: hand.length,
      opponentHandCounts: context.opponents.map((opponent) => opponent.handCount),
      lastPlay: context.lastPlay ? `${context.lastPlay.by}打出 ${context.lastPlay.description}` : null,
      playedCards: context.playedCards,
      candidates: context.candidates,
      modelId: trace?.modelId ?? null,
      system: trace?.system ?? null,
      prompt: trace?.prompt ?? null,
      rawText: trace?.rawText ?? null,
      reasoningText: trace?.reasoningText ?? null,
      finishReason: trace?.finishReason ?? null,
      usage: trace?.usage ?? null,
      requestSummary: trace?.requestSummary ?? null,
      latencyMs,
      outcome
    });
  }
}

function buildLabels(legal: readonly LegalMove[], canPass: boolean): string[] {
  const moves = legal.map((move) => describeCombination(move.combination));
  return canPass ? ["过牌(不出)", ...moves] : moves;
}

function buildContext(
  snapshot: GameSnapshot,
  playerId: PlayerId,
  hand: readonly Card[],
  playedCards: readonly Card[],
  previous: Combination | null,
  labels: readonly string[]
): MoveSelectionContext {
  const landlordId = snapshot.landlordId;
  const lastPlayerId = snapshot.lastPlay?.playerId ?? null;
  return {
    role: landlordId === playerId ? "landlord" : "farmer",
    hand: groupCardsByRank(hand),
    playedCards: groupCardsByRank(playedCards),
    opponents: snapshot.players
      .filter((player) => player.id !== playerId)
      .map((player) => ({ label: seatRoleLabel(player.id, playerId, landlordId), handCount: player.handCount })),
    lastPlay:
      previous && lastPlayerId
        ? { by: seatRoleLabel(lastPlayerId, playerId, landlordId), description: describeCombination(previous) }
        : null,
    candidates: labels
  };
}

/** 某玩家相对自己的身份标签:地主 / 队友(自己是农民时的另一农民)/ 农民(自己是地主时的对手)。 */
function seatRoleLabel(targetId: PlayerId, selfId: PlayerId, landlordId: PlayerId | null): string {
  if (targetId === landlordId) {
    return "地主";
  }
  return selfId === landlordId ? "农民" : "队友";
}

/** 把一组牌按从小到大分组成中文计数,如 ["3","5×2","J","2×2"];供「自己手牌」与「本局已出」复用。 */
function groupCardsByRank(cards: readonly Card[]): string[] {
  const counts = new Map<Rank, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort(compareRank)
    .map((rank) => {
      const count = counts.get(rank) ?? 0;
      const label = rankLabel(rank);
      return count > 1 ? `${label}×${count}` : label;
    });
}

/**
 * AI 输出流节流:模型增量逐 token 太碎(每片可能 1~3 字),累积到 ≥ minChars 才成片发出,避免广播风暴。
 * 攒够则返回整段 chunk、rest 清空;不足则 chunk=null、rest 保留待续。done 收尾时由调用方直接取走剩余。
 * 纯函数,导出供 DdzRoom 节流广播与单测复用。
 */
export function takeThinkingChunk(pending: string, minChars: number): { chunk: string | null; rest: string } {
  return pending.length >= minChars ? { chunk: pending, rest: "" } : { chunk: null, rest: pending };
}

/** 把候选编号映射回具体动作;canPass 时编号 0 为过牌。越界返回 null(由调用方抛错暴露)。 */
function toAction(index: number, canPass: boolean, legal: readonly LegalMove[]): BotAction | null {
  if (canPass && index === 0) {
    return { type: "pass" };
  }
  const move = legal[canPass ? index - 1 : index];
  if (!move) {
    return null;
  }
  return { type: "play_cards", cards: move.cards.map((card) => card.id) };
}
