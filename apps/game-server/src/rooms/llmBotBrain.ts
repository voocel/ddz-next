import { compareRank, createDeck, enumerateLegalMoves, identifyCombination } from "@ddz/domain";
import type { Card, Combination, GameSnapshot, LegalMove, PlayerId, PlayHistoryEntry, Rank } from "@ddz/domain";
import type {
  BidChooser,
  BiddingContext,
  ChooserTrace,
  RecentActionInfo,
  MoveChooser,
  MoveDecision,
  MoveSelectionContext,
  MoveStreamDelta,
  MoveStreamHooks,
  TurnOrderInfo,
  LlmRequestErrorInfo,
  ProviderRequestSummary,
  ProviderHttpTrace,
  TokenUsage
} from "@ddz/bot-ai";
import type { BotAction, BotBrain } from "./botBrain.js";
import { describeCombination, rankLabel } from "./combinationLabels.js";

const RECENT_ACTION_LIMIT = 10;

/** 一次成功 LLM 出牌决策的可观测指标(失败不再回退,而是抛错,故无 fallback 记录)。 */
export interface LlmDecisionMetric {
  readonly latencyMs: number;
  readonly usage: TokenUsage | null;
}

/** LLM 成功解析出的候选选择:index 为内部 0 基索引,label 是当手候选列表中该编号对应的具体动作。 */
export interface LlmDecisionChoice {
  readonly index: number;
  readonly label: string;
}

/** 一次 LLM 出牌决策的结局(四选一);ok 才有动作。 */
export type LlmDecisionOutcome =
  | { readonly kind: "ok"; readonly index: number; readonly action: BotAction }
  | { readonly kind: "empty_response"; readonly finishReason: string | null }
  | { readonly kind: "no_choice" }
  | { readonly kind: "invalid_index"; readonly index: number }
  | { readonly kind: "error"; readonly message: string };

/**
 * 一次出牌决策的完整留证:游戏上下文 + 该 bot 完整手牌 + 模型 IO/思考 + 用量 + 延迟 + 结局。
 * 仅服务端落盘(JSONL),供逐手排错/优化;不含密钥。四种结局每种都会产出一条。
 */
export interface LlmDecisionTrace {
  readonly playerId: PlayerId;
  /** 本次真正喂给 LLM 的结构化局势上下文(出牌或叫抢);prompt 由它渲染,trace 也按它复盘。 */
  readonly context: MoveSelectionContext | BiddingContext;
  readonly selfHand: readonly string[];
  readonly selfHandCount: number;
  readonly modelId: string | null;
  readonly system: string | null;
  readonly prompt: string | null;
  readonly rawText: string | null;
  readonly reasoningText: string | null;
  readonly finishReason: string | null;
  readonly usage: TokenUsage | null;
  readonly requestSummary: ProviderRequestSummary | null;
  readonly httpTrace: ProviderHttpTrace | null;
  readonly errorInfo: LlmRequestErrorInfo | null;
  readonly latencyMs: number;
  readonly outcome: LlmDecisionOutcome;
}

/**
 * LLM 出牌决策失败:请求出错(abort/API/网络)、无有效返回(解析失败)或越界。
 * 决策机器人不再静默回退规则 bot——目的是实验验证 LLM 真实表现,有错就暴露。
 */
export class LlmDecisionError extends Error {
  constructor(
    readonly reason: "empty_response" | "no_choice" | "invalid_index" | "request_error",
    message: string,
    readonly latencyMs: number,
    readonly detail: Record<string, string | number | boolean | null> | null = null
  ) {
    super(message);
    this.name = "LlmDecisionError";
  }
}

export interface LlmBotBrainOptions {
  readonly chooser: MoveChooser;
  /** 叫/抢地主决策器:与出牌同为 LLM 候选编号制,失败同样抛错暴露,绝不回退规则 bot。 */
  readonly bidChooser: BidChooser;
  readonly onDecision?: ((metric: LlmDecisionMetric) => void) | undefined;
  /** 每次 LLM 出牌决策(成功/no_choice/越界/请求出错)都回调一次完整留证,供落盘排错;不设则不记。 */
  readonly onTrace?: ((trace: LlmDecisionTrace) => void) | undefined;
  /** 出牌决策正式发起 LLM 请求前回调一次,供上层清理上一手面板并显示“准备分析”。 */
  readonly onStreamStart?: ((playerId: PlayerId) => void) | undefined;
  /** 出牌决策过程中实时回调模型输出增量(playerId + channel + 片段),供上层做牌桌「AI 输出流」;不设则不回调。 */
  readonly onStreamDelta?: ((playerId: PlayerId, delta: MoveStreamDelta) => void) | undefined;
  /** 模型最终编号合法后回调其对应候选动作,供上层把内部索引展示成「单张4」等具体结果。 */
  readonly onChoice?: ((playerId: PlayerId, choice: LlmDecisionChoice) => void) | undefined;
  /** 可注入时钟,便于测试测延迟;默认 Date.now。 */
  readonly now?: () => number;
}

/**
 * LLM 决策机器人:叫/抢地主与出牌全部由大模型决策,共用候选编号制——
 * 候选由服务端枚举给出,模型只能在其中选,天然杜绝非法动作;
 * 任何 null/越界/超时/缺 key 都直接抛错暴露(不回退),让实验能看到模型的真实失败。
 * 决策一律在串行锁外执行(见 BotBrain 契约);线上抛错由房间 onFailure 收口(故障关房 + 日志)。
 */
export class LlmBotBrain implements BotBrain {
  private readonly now: () => number;

  constructor(private readonly options: LlmBotBrainOptions) {
    this.now = options.now ?? Date.now;
  }

  async decide(
    snapshot: GameSnapshot,
    playerId: PlayerId,
    hand: readonly Card[],
    playedCards: readonly Card[],
    history: readonly PlayHistoryEntry[] = []
  ): Promise<BotAction> {
    if (snapshot.phase === "bidding" || snapshot.phase === "robbing") {
      return this.decideBid(snapshot, playerId, hand, history);
    }

    if (snapshot.phase !== "playing") {
      throw new Error(`Cannot decide bot action during ${snapshot.phase} phase.`);
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

    const context = buildContext(snapshot, playerId, hand, playedCards, history, previous, labels);
    return this.runChoice({
      playerId,
      hand,
      context,
      labels,
      choose: (streamHooks) => this.options.chooser.choose(context, streamHooks),
      toAction: (index) => toAction(index, canPass, legal)
    });
  }

  /** 叫/抢地主:候选固定两项(不叫/叫、不抢/抢),同一套编号制与错误分类。 */
  private async decideBid(
    snapshot: GameSnapshot,
    playerId: PlayerId,
    hand: readonly Card[],
    history: readonly PlayHistoryEntry[]
  ): Promise<BotAction> {
    const kind = snapshot.phase === "bidding" ? "bidding" : "robbing";
    const labels = kind === "bidding" ? ["不叫", "叫地主"] : ["不抢", "抢地主"];
    const context: BiddingContext = {
      kind,
      hand: groupCardsByRank(hand),
      bidHistory: bidHistory(snapshot, history, playerId),
      currentMultiplier: snapshot.multiplier,
      // 首叫者再次获得抢地主回合,只可能是「地主位被抢走后的唯一一次反抢」(见 GameTable.robLandlord)。
      isCounterRob:
        kind === "robbing" && history.some((entry) => entry.type === "bid" && entry.playerId === playerId && entry.called),
      candidates: labels
    };
    return this.runChoice({
      playerId,
      hand,
      context,
      labels,
      choose: (streamHooks) => this.options.bidChooser.choose(context, streamHooks),
      toAction: (index) => {
        if (index !== 0 && index !== 1) {
          return null;
        }
        return kind === "bidding"
          ? { type: "bid_landlord", called: index === 1 }
          : { type: "rob_landlord", robbed: index === 1 };
      }
    });
  }

  /**
   * 出牌与叫抢共用的决策执行:流式钩子接线、延迟计时、五步结局分类(请求出错/空响应/无有效编号/越界/成功)、
   * trace 留证与指标回调。失败一律抛 LlmDecisionError 暴露,绝不静默。
   */
  private async runChoice(request: {
    readonly playerId: PlayerId;
    readonly hand: readonly Card[];
    readonly context: MoveSelectionContext | BiddingContext;
    readonly labels: readonly string[];
    readonly choose: (streamHooks?: MoveStreamHooks) => Promise<MoveDecision | null>;
    readonly toAction: (index: number) => BotAction | null;
  }): Promise<BotAction> {
    const { playerId, hand, context, labels } = request;
    this.options.onStreamStart?.(playerId);
    // AI 输出流:把模型 reasoning/text 增量带上 playerId 转给上层(只在 LLM 决策路径产生,强制动作不产生)。
    const onStreamDelta = this.options.onStreamDelta;
    const streamHooks: MoveStreamHooks | undefined = onStreamDelta
      ? { onDelta: (delta) => onStreamDelta(playerId, delta) }
      : undefined;
    const start = this.now();
    let decision: MoveDecision | null;
    try {
      decision = await request.choose(streamHooks);
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
      const detail = summarizeLlmRequestFailure(trace);
      throw new LlmDecisionError(
        "request_error",
        `LLM 请求失败: ${trace.error}${formatLlmRequestFailure(detail)}(候选 ${labels.length} 项)`,
        latencyMs,
        detail
      );
    }
    // 2) 上游/SDK 返回了“成功但正文为空”的结果:不是牌力问题,直接显式暴露为上游空响应。
    if (decision.index === null) {
      if (isEmptyLlmResponse(trace)) {
        this.emitTrace(context, hand, playerId, trace, latencyMs, {
          kind: "empty_response",
          finishReason: trace.finishReason
        });
        // reasoning 字数用于区分「上游整个空回」(0 字,多为中转故障)与「思考被截断没给最终答案」(有字,看 finishReason=length)
        const detail = summarizeLlmRequestFailure(trace);
        throw new LlmDecisionError(
          "empty_response",
          `LLM 上游返回空响应(rawText 为空,reasoning ${trace.reasoningText?.length ?? 0} 字,finishReason=${trace.finishReason ?? "null"})${formatLlmRequestFailure(detail)};候选 ${labels.length} 项`,
          latencyMs,
          detail
        );
      }
      // 3) 模型有正文但解析不出有效编号。
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "no_choice" });
      throw new LlmDecisionError(
        "no_choice",
        `LLM 未给出有效选择(回复中无法解析出有效编号或越界);候选 ${labels.length} 项`,
        latencyMs
      );
    }
    // 4) 编号越界。
    const action = request.toAction(decision.index);
    const label = labels[decision.index];
    if (!action || !label) {
      this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "invalid_index", index: decision.index });
      throw new LlmDecisionError(
        "invalid_index",
        `LLM 返回越界选择 index=${decision.index}(候选 ${labels.length} 项)`,
        latencyMs
      );
    }
    // 5) 成功。
    this.options.onChoice?.(playerId, { index: decision.index, label });
    this.emitTrace(context, hand, playerId, trace, latencyMs, { kind: "ok", index: decision.index, action });
    this.options.onDecision?.({ latencyMs, usage: trace.usage });
    return action;
  }

  /** 把游戏上下文 + 该 bot 手牌 + chooser 留证 + 结局拼成一条完整 trace 交给 onTrace(未设则跳过)。 */
  private emitTrace(
    context: MoveSelectionContext | BiddingContext,
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
      context,
      selfHand: hand.map((card) => card.id),
      selfHandCount: hand.length,
      modelId: trace?.modelId ?? null,
      system: trace?.system ?? null,
      prompt: trace?.prompt ?? null,
      rawText: trace?.rawText ?? null,
      reasoningText: trace?.reasoningText ?? null,
      finishReason: trace?.finishReason ?? null,
      usage: trace?.usage ?? null,
      requestSummary: trace?.requestSummary ?? null,
      httpTrace: trace?.httpTrace ?? null,
      errorInfo: trace?.errorInfo ?? null,
      latencyMs,
      outcome
    });
  }
}

function buildLabels(legal: readonly LegalMove[], canPass: boolean): string[] {
  const moves = legal.map((move) => describeCombination(move.combination));
  return canPass ? ["过牌(不出)", ...moves] : moves;
}

function isEmptyLlmResponse(trace: ChooserTrace): boolean {
  return trace.rawText !== null && trace.rawText.trim().length === 0;
}

function summarizeLlmRequestFailure(trace: ChooserTrace): Record<string, string | number | boolean | null> | null {
  const error = trace.errorInfo;
  const provider = trace.requestSummary.provider;
  const code = errorCodeOf(error?.data);
  const requestId = requestIdOf(error?.responseHeaders, error?.responseBody);
  const detail: Record<string, string | number | boolean | null> = {};
  if (provider) {
    detail.provider = `${provider.key}/${provider.type}`;
    detail.baseHost = provider.baseHost;
  }
  if (trace.modelId) {
    detail.model = trace.modelId;
  }
  // 上游最后一次 HTTP 的状态码与内容类型:contentType=text/html 即「baseURL 配错打到网页」这类误配的一眼铁证
  const lastResponse = trace.httpTrace?.requests[trace.httpTrace.requests.length - 1]?.response;
  if (lastResponse) {
    detail.statusCode ??= lastResponse.status;
    const contentType = lastResponse.headers["content-type"];
    if (contentType) {
      detail.contentType = contentType.split(";")[0]!.trim();
    }
  }
  if (error?.statusCode !== null && error?.statusCode !== undefined) {
    detail.statusCode = error.statusCode;
  }
  if (code) {
    detail.code = code;
  }
  if (error?.url) {
    detail.url = error.url;
  }
  if (requestId) {
    detail.requestId = requestId;
  }
  if (typeof error?.isRetryable === "boolean") {
    detail.isRetryable = error.isRetryable;
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

function formatLlmRequestFailure(detail: Record<string, string | number | boolean | null> | null): string {
  if (!detail) {
    return "";
  }
  const text = Object.entries(detail)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return text ? ` [${text}]` : "";
}

function errorCodeOf(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }
  const error = data.error;
  if (!isRecord(error)) {
    return null;
  }
  return typeof error.code === "string" && error.code.trim() ? error.code : null;
}

function requestIdOf(headers: Record<string, string> | null | undefined, body: string | null | undefined): string | null {
  const headerRequestId = headers?.["x-oneapi-request-id"] ?? headers?.["x-request-id"] ?? headers?.["request-id"];
  if (headerRequestId?.trim()) {
    return headerRequestId;
  }
  const match = body?.match(/\(request id:\s*([^)]+)\)/i);
  return match?.[1]?.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildContext(
  snapshot: GameSnapshot,
  playerId: PlayerId,
  hand: readonly Card[],
  playedCards: readonly Card[],
  history: readonly PlayHistoryEntry[],
  previous: Combination | null,
  labels: readonly string[]
): MoveSelectionContext {
  const landlordId = snapshot.landlordId;
  const lastPlayerId = snapshot.lastPlay?.playerId ?? null;
  return {
    role: landlordId === playerId ? "landlord" : "farmer",
    hand: groupCardsByRank(hand),
    landlordCards: groupCardsByRank(snapshot.landlordCards),
    playedCards: groupCardsByRank(playedCards),
    unseenCards: groupCardsByRank(unseenCards(hand, playedCards, snapshot.landlordCards)),
    turnOrder: turnOrder(snapshot, playerId, landlordId),
    opponents: snapshot.players
      .filter((player) => player.id !== playerId)
      .map((player) => ({
        label: seatRoleLabel(snapshot, player.id, playerId, landlordId),
        handCount: player.handCount,
        revealedCards: []
      })),
    lastPlay:
      previous && lastPlayerId
        ? { by: seatRoleLabel(snapshot, lastPlayerId, playerId, landlordId), description: describeCombination(previous) }
        : null,
    recentActions: recentActions(snapshot, history, playerId, landlordId),
    candidates: labels
  };
}

function turnOrder(snapshot: GameSnapshot, selfId: PlayerId, landlordId: PlayerId | null): TurnOrderInfo[] {
  const players = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const selfIndex = players.findIndex((player) => player.id === selfId);
  if (selfIndex === -1) {
    return [];
  }
  return [...players.slice(selfIndex), ...players.slice(0, selfIndex)].map((player) => ({
    label: actionActorLabel(snapshot, player.id, selfId, landlordId),
    handCount: player.handCount
  }));
}

function recentActions(
  snapshot: GameSnapshot,
  history: readonly PlayHistoryEntry[],
  selfId: PlayerId,
  landlordId: PlayerId | null
): RecentActionInfo[] {
  return history.slice(-RECENT_ACTION_LIMIT).map((entry) => {
    const by = actionActorLabel(snapshot, entry.playerId, selfId, landlordId);
    switch (entry.type) {
      case "play":
        return { by, action: "play" as const, description: describeCombinationFromCards(entry.cards) };
      case "pass":
        return { by, action: "pass" as const };
      case "bid":
        return { by, action: "bid" as const, description: describeBidEntry(entry) };
      case "rob":
        return { by, action: "rob" as const, description: describeBidEntry(entry) };
    }
  });
}

/** 叫/抢动作的中文描述,叫抢 prompt 与出牌 prompt 的「最近动作」共用。 */
function describeBidEntry(entry: Extract<PlayHistoryEntry, { type: "bid" | "rob" }>): string {
  return entry.type === "bid" ? (entry.called ? "叫地主" : "不叫") : entry.robbed ? "抢地主" : "不抢";
}

/** 叫抢阶段的公开过程:此时身份未定,行动者标签用相对座位(你/下家/上家)。 */
function bidHistory(snapshot: GameSnapshot, history: readonly PlayHistoryEntry[], selfId: PlayerId): RecentActionInfo[] {
  return history
    .filter((entry): entry is Extract<PlayHistoryEntry, { type: "bid" | "rob" }> => entry.type === "bid" || entry.type === "rob")
    .map((entry) => ({
      by: bidActorLabel(snapshot, entry.playerId, selfId),
      action: entry.type,
      description: describeBidEntry(entry)
    }));
}

function bidActorLabel(snapshot: GameSnapshot, targetId: PlayerId, selfId: PlayerId): string {
  if (targetId === selfId) {
    return "你";
  }
  const players = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const selfIndex = players.findIndex((player) => player.id === selfId);
  const targetIndex = players.findIndex((player) => player.id === targetId);
  if (selfIndex === -1 || targetIndex === -1) {
    return "另一家";
  }
  const distance = (targetIndex - selfIndex + players.length) % players.length;
  if (distance === 1) {
    return "下家";
  }
  if (distance === players.length - 1) {
    return "上家";
  }
  return "另一家";
}

function unseenCards(hand: readonly Card[], playedCards: readonly Card[], landlordCards: readonly Card[]): Card[] {
  const seen = new Map<string, number>();
  for (const card of [...hand, ...playedCards, ...landlordCards]) {
    seen.set(card.id, (seen.get(card.id) ?? 0) + 1);
  }
  return createDeck().filter((card) => {
    const count = seen.get(card.id) ?? 0;
    if (count <= 0) {
      return true;
    }
    seen.set(card.id, count - 1);
    return false;
  });
}

/** 某玩家相对自己的身份标签:地主 / 队友 / 上下家农民。 */
function seatRoleLabel(
  snapshot: GameSnapshot,
  targetId: PlayerId,
  selfId: PlayerId,
  landlordId: PlayerId | null
): string {
  if (targetId === landlordId) {
    return "地主";
  }
  return selfId === landlordId ? farmerSeatLabel(snapshot, targetId, selfId) : "队友";
}

function actionActorLabel(
  snapshot: GameSnapshot,
  targetId: PlayerId,
  selfId: PlayerId,
  landlordId: PlayerId | null
): string {
  return targetId === selfId ? "你" : seatRoleLabel(snapshot, targetId, selfId, landlordId);
}

function farmerSeatLabel(snapshot: GameSnapshot, targetId: PlayerId, selfId: PlayerId): string {
  const players = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const selfIndex = players.findIndex((player) => player.id === selfId);
  const targetIndex = players.findIndex((player) => player.id === targetId);
  if (selfIndex === -1 || targetIndex === -1 || players.length < 2) {
    return "农民";
  }
  const distance = (targetIndex - selfIndex + players.length) % players.length;
  if (distance === 1) {
    return "下家农民";
  }
  if (distance === players.length - 1) {
    return "上家农民";
  }
  return "农民";
}

function describeCombinationFromCards(cards: readonly Card[]): string {
  const combination = identifyCombination(cards);
  return combination ? describeCombination(combination) : groupCardsByRank(cards).join(" ");
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
