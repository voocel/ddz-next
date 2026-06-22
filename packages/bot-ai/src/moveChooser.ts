import { streamText, type JSONValue, type LanguageModel } from "ai";
import {
  createLlmHttpTraceScope,
  finishLlmHttpTraceScope,
  runWithLlmHttpTraceScope,
  type LlmHttpTrace
} from "./httpTrace.js";

/** 其他一家:相对自己的身份(地主/队友/农民)+ 剩牌数 + 当前公开可见的手牌。 */
export interface OpponentInfo {
  readonly label: string;
  readonly handCount: number;
  /**
   * 对该 AI 当前公开可见的对手手牌(按从小到大分组的中文描述)。
   * 普通暗牌局为空;以后支持明牌/局部公开时直接填这里。
   */
  readonly revealedCards: readonly string[];
}

/** 上一手:由谁(按角色)打出的什么牌型。 */
export interface LastPlayInfo {
  /** 打出者相对自己的身份,如「地主」「队友」「农民」。 */
  readonly by: string;
  /** 牌型描述,如「对子7」。 */
  readonly description: string;
}

export interface RecentActionInfo {
  /** 行动者相对自己的身份,如「你」「地主」「队友」「农民」。 */
  readonly by: string;
  readonly action: "play" | "pass";
  /** action=play 时的牌型/牌点简述;pass 时省略。 */
  readonly description?: string;
}

export interface TurnOrderInfo {
  readonly label: string;
  readonly handCount: number;
}

/**
 * 选牌所需的公开局势 + 候选走法(由调用方从快照映射,bot-ai 不依赖游戏内部类型)。
 * 刻意给足农民/地主决策所需的公开事实:自己的完整手牌、本局已出的牌、各家身份+剩牌+明牌、上一手由谁打出——
 * 但不灌输策略(出什么由模型自己定),以如实验证模型牌力。
 * candidates 是中文走法标签;对模型展示为 1..N 编号,内部仍按数组 0 基索引返回。
 * 过牌等特殊选项也由调用方放进列表。
 */
export interface MoveSelectionContext {
  readonly role: "landlord" | "farmer";
  /** 自己的完整手牌(按从小到大分组的中文描述,如 ["3","5×2","J","2×2"]),供模型规划。 */
  readonly hand: readonly string[];
  /** 地主底牌(公开后按从小到大分组);叫抢阶段不会调用 LLM 出牌,正常出牌时已公开。 */
  readonly landlordCards?: readonly string[];
  /**
   * 本局已出的牌(按从小到大分组的中文,如 ["3×2","K","大王"])。公开信息、桌上人人可见,
   * 给模型用于记牌、推断各点数还剩多少未现——这是事实而非策略。开局领出、本局尚无人出牌时为空数组。
   */
  readonly playedCards: readonly string[];
  /** 当前公开信息下尚未出现的牌(不含自己手牌、已出牌、地主底牌),帮助模型稳定记牌。 */
  readonly unseenCards?: readonly string[];
  /** 从自己开始的出牌顺序与剩牌数。 */
  readonly turnOrder?: readonly TurnOrderInfo[];
  /** 其他两家,按座位顺序;含身份标签/剩牌/公开可见手牌,农民据此分辨地主与队友。 */
  readonly opponents: readonly OpponentInfo[];
  /** 上一手由谁打出的什么;轮到领出时为 null。 */
  readonly lastPlay: LastPlayInfo | null;
  /** 最近公开动作,有界保留,用于理解谁连续出牌/谁过牌/自己刚做过什么。 */
  readonly recentActions?: readonly RecentActionInfo[];
  /** 候选走法标签,至少一项;模型只能在提示词展示的 1..N 编号中选一项。 */
  readonly candidates: readonly string[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderRequestSummary {
  readonly provider: {
    readonly key: string;
    readonly type: string;
    readonly baseHost: string | null;
  } | null;
  readonly providerOptions: Record<string, Record<string, JSONValue>> | null;
  readonly requestControls: Record<string, JSONValue> | null;
  readonly finalBodyControls: Record<string, JSONValue> | null;
}

/** 本次 LLM 调用经过 provider fetch 看到的上游 HTTP 原始请求/响应。请求头会脱敏,响应体不截断。 */
export type ProviderHttpTrace = LlmHttpTrace;

/** LLM API/网络错误的结构化留证。只记录无密钥字段,便于定位 provider 路径、状态码与上游错误体。 */
export interface LlmRequestErrorInfo {
  readonly name: string | null;
  readonly message: string;
  readonly url: string | null;
  readonly statusCode: number | null;
  readonly responseHeaders: Record<string, string> | null;
  readonly responseBody: string | null;
  readonly data: JSONValue | null;
  readonly isRetryable: boolean | null;
}

/**
 * 一次完整请求的全量留证(供排错/优化):请求的 system/prompt、模型思考 reasoning、原始输出、用量、错误。
 * 不含任何密钥。无论解析成功与否,只要发出过请求就有 trace(连 abort/API 错误也连 prompt 一起留)。
 */
export interface ChooserTrace {
  readonly modelId: string | null;
  readonly system: string;
  readonly prompt: string;
  readonly rawText: string | null;
  readonly reasoningText: string | null;
  readonly finishReason: string | null;
  readonly usage: TokenUsage | null;
  readonly requestSummary: ProviderRequestSummary;
  readonly httpTrace: ProviderHttpTrace | null;
  /** abort/API/网络错误的消息;成功为 null。错误已被捕获进 trace,但调用方仍应据此抛错暴露(不静默)。 */
  readonly error: string | null;
  readonly errorStack: string | null;
  readonly errorInfo: LlmRequestErrorInfo | null;
}

export interface MoveDecision {
  /** 解析出的合法候选内部索引(0 基);模型有响应但解析不出/越界,或请求出错时为 null。 */
  readonly index: number | null;
  readonly trace: ChooserTrace;
}

export type MoveStreamChannel = "reasoning" | "text";

export interface MoveStreamDelta {
  readonly channel: MoveStreamChannel;
  readonly text: string;
}

/**
 * 流式钩子:决策进行中实时吐出模型的 reasoning 与普通文本增量,供上层做「AI 输出流」展示。
 * 可选,不传则只等最终结果(行为与非流式等价)。
 */
export interface MoveStreamHooks {
  readonly onDelta?: (delta: MoveStreamDelta) => void;
}

/**
 * LLM 选牌器:在调用方给出的合法候选里选一个索引。
 * 返回 null 仅表示「没发请求」(model 为 null / 无候选);否则返回带完整 trace 的 MoveDecision。
 * API/网络/超时错误被捕获进 trace.error(不抛),由调用方据此抛错暴露——既留证又不静默。
 * streamHooks 可选:传入时在决策过程中实时回调模型 reasoning/text 增量(用于牌桌「AI 输出流」展示)。
 */
export interface MoveChooser {
  choose(ctx: MoveSelectionContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null>;
}

export interface LlmMoveChooserOptions {
  /** 已由供应商注册表解析好的语言模型;为 null(缺密钥/未配置)时直接返回 null,不发起请求。 */
  readonly model: LanguageModel | null;
  readonly timeoutMs?: number;
  /** 无密钥 provider 元信息,只用于 trace 排错。 */
  readonly provider?: {
    readonly key: string;
    readonly type: string;
    readonly baseURL?: string | undefined;
  } | undefined;
  /**
   * 透传给 streamText 的 provider 专属选项(如思考强度);由 buildReasoningProviderOptions 产出。
   * 不设/undefined 表示不干预,跟随模型默认。
   */
  readonly providerOptions?: Record<string, Record<string, JSONValue>> | undefined;
}

// 与 config.ts 的 DEFAULT_DECISION_TIMEOUT_MS 对齐:推理模型单步思考偏慢,给足头寸(生产路径总会显式传 timeoutMs)。
const DEFAULT_TIMEOUT_MS = 60_000;
// 推理/thinking 模型的「思考」也算进 output token,留足空间避免在思考中途被截断而拿不到最终编号;
// 普通模型按 prompt「只回复一个数字」会很快停,不会用满。
const MAX_OUTPUT_TOKENS = 8192;

export class LlmMoveChooser implements MoveChooser {
  constructor(private readonly options: LlmMoveChooserOptions) {}

  async choose(ctx: MoveSelectionContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null> {
    const model = this.options.model;
    if (ctx.candidates.length === 0 || !model) {
      return null;
    }

    const system = buildSystem(ctx.role);
    const prompt = formatMoveSelectionPrompt(ctx);
    const modelId = typeof model === "string" ? model : (model.modelId ?? null);
    const requestSummary = summarizeRequest(this.options.providerOptions, this.options.provider);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const httpTraceScope = createLlmHttpTraceScope();
    // 三条刻意的选择:
    // 1) 把 API/超时/网络错误捕获进 trace.error(而非直接抛),好连同 system/prompt 一起留证;
    //    异常本身仍由调用方据 trace.error 抛错暴露(见 LlmBotBrain),不静默。
    // 2) 不用强制 tool_choice——很多推理模型(deepseek-v4-pro、o1 类)不支持强制工具调用,
    //    改用最通用的「只回复编号数字」纯文本输出,跨 provider 一致;模型有响应但解析不出有效编号时 index=null。
    // 3) 用 streamText 而非 generateText:遍历 fullStream 实时把 reasoning/text 增量回调给 streamHooks(牌桌 AI 输出流);
    //    error part 显式捕获 + allSettled 收尾(消费所有 promise 拒绝,既不静默错误也不留未处理拒绝)。
    try {
      return await runWithLlmHttpTraceScope(httpTraceScope, async () => {
      const result = streamText({
        model,
        system,
        prompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
        ...(this.options.providerOptions ? { providerOptions: this.options.providerOptions } : {})
      });

      let streamError: unknown = null;
      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") {
          streamHooks?.onDelta?.({ channel: "reasoning", text: part.text });
        } else if (part.type === "text-delta") {
          streamHooks?.onDelta?.({ channel: "text", text: part.text });
        } else if (part.type === "error") {
          streamError = part.error;
        }
      }

      // 用 allSettled 一次性收齐最终值:即便流出错也消费掉每个 promise 的 rejection,
      // 避免「未处理拒绝」拖垮(服务端)进程;错误优先取 error part,其次取 text 的拒因——保证不静默。
      const [textR, reasoningR, finishR, usageR, requestR] = await Promise.allSettled([
        result.text,
        result.reasoningText,
        result.finishReason,
        result.usage,
        result.request
      ]);
      if (streamError === null && textR.status === "rejected") {
        streamError = textR.reason;
      }
      if (streamError !== null) {
        throw streamError instanceof Error ? streamError : new Error(String(streamError));
      }

      const text = textR.status === "fulfilled" ? textR.value : "";
      const reasoningText = reasoningR.status === "fulfilled" ? reasoningR.value : undefined;
      const finishReason = finishR.status === "fulfilled" ? finishR.value : null;
      const usage = usageR.status === "fulfilled" ? usageR.value : undefined;
      const finalRequestSummary =
        requestR.status === "fulfilled" ? withFinalBodyControls(requestSummary, requestBodyOf(requestR.value)) : requestSummary;

      const httpTrace = await finishLlmHttpTraceScope(httpTraceScope);
      return {
        index: parseMoveIndex(text, ctx.candidates.length),
        trace: {
          modelId,
          system,
          prompt,
          rawText: text,
          reasoningText: reasoningText ?? null,
          finishReason: finishReason ?? null,
          usage: toUsage(usage),
          requestSummary: finalRequestSummary,
          httpTrace,
          error: null,
          errorStack: null,
          errorInfo: null
        }
      };
      });
    } catch (error) {
      const errorInfo = toRequestErrorInfo(error);
      const httpTrace = await finishLlmHttpTraceScope(httpTraceScope);
      return {
        index: null,
        trace: {
          modelId,
          system,
          prompt,
          rawText: null,
          reasoningText: null,
          finishReason: null,
          usage: null,
          requestSummary,
          httpTrace,
          error: errorInfo.message,
          errorStack: error instanceof Error ? (error.stack ?? null) : null,
          errorInfo
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 从模型回复中解析出展示编号(1..count),再映射为内部 0 基索引。导出供单测。
 * - number:按展示编号校验范围。
 * - string:纯数字直接用;夹带解释时取文本里第一个落在展示范围内的整数(prompt 已要求只回数字,这是兜底)。
 * 解析不出有效编号返回 null(由调用方按「模型未给出有效选择」处理)。
 */
export function parseMoveIndex(raw: unknown, count: number): number | null {
  if (!Number.isInteger(count) || count <= 0) {
    return null;
  }
  let displayNumber: number | null = null;
  if (typeof raw === "number") {
    displayNumber = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      displayNumber = Number(trimmed);
    } else {
      for (const match of trimmed.match(/-?\d+(?:\.\d+)?/g) ?? []) {
        const candidate = Number(match);
        if (Number.isInteger(candidate) && candidate >= 1 && candidate <= count) {
          displayNumber = candidate;
          break;
        }
      }
    }
  }
  if (displayNumber === null || !Number.isInteger(displayNumber) || displayNumber < 1 || displayNumber > count) {
    return null;
  }
  return displayNumber - 1;
}

function toUsage(
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined
): TokenUsage | null {
  if (!usage || typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") {
    return null;
  }
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

function toRequestErrorInfo(error: unknown): LlmRequestErrorInfo {
  const record = isPlainRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  return {
    name: error instanceof Error ? error.name : typeof record.name === "string" ? record.name : null,
    message,
    url: typeof record.url === "string" ? record.url : null,
    statusCode: typeof record.statusCode === "number" ? record.statusCode : null,
    responseHeaders: stringRecordOrNull(record.responseHeaders),
    responseBody: typeof record.responseBody === "string" ? record.responseBody : null,
    data: isJsonValue(record.data) ? record.data : null,
    isRetryable: typeof record.isRetryable === "boolean" ? record.isRetryable : null
  };
}

function stringRecordOrNull(value: unknown): Record<string, string> | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function summarizeRequest(
  providerOptions: Record<string, Record<string, JSONValue>> | undefined,
  provider: LlmMoveChooserOptions["provider"]
): ProviderRequestSummary {
  const providerControls = Object.values(providerOptions ?? {}).find((options) =>
    Object.hasOwn(options, "thinking") ||
    Object.hasOwn(options, "reasoning_effort") ||
    Object.hasOwn(options, "effort") ||
    Object.hasOwn(options, "output_config")
  );
  const controls: Record<string, JSONValue> = {};
  if (providerControls && Object.hasOwn(providerControls, "thinking")) {
    const thinking = providerControls.thinking;
    if (thinking !== undefined) {
      controls.thinking = thinking;
    }
  }
  if (providerControls && Object.hasOwn(providerControls, "reasoning_effort")) {
    const reasoningEffort = providerControls.reasoning_effort;
    if (reasoningEffort !== undefined) {
      controls.reasoning_effort = reasoningEffort;
    }
  }
  if (providerControls && Object.hasOwn(providerControls, "effort")) {
    const effort = providerControls.effort;
    if (effort !== undefined) {
      controls.effort = effort;
    }
  }
  if (providerControls && Object.hasOwn(providerControls, "output_config")) {
    const outputConfig = providerControls.output_config;
    if (outputConfig !== undefined) {
      controls.output_config = outputConfig;
    }
  }
  return {
    provider: summarizeProvider(provider),
    providerOptions: providerOptions ?? null,
    requestControls: Object.keys(controls).length > 0 ? controls : null,
    finalBodyControls: null
  };
}

function summarizeProvider(provider: LlmMoveChooserOptions["provider"]): ProviderRequestSummary["provider"] {
  if (!provider) {
    return null;
  }
  return {
    key: provider.key,
    type: provider.type,
    baseHost: provider.baseURL ? hostOf(provider.baseURL) : null
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function requestBodyOf(request: unknown): unknown {
  return isPlainRecord(request) && Object.hasOwn(request, "body") ? request.body : undefined;
}

function withFinalBodyControls(summary: ProviderRequestSummary, body: unknown): ProviderRequestSummary {
  const parsed = parseRequestBody(body);
  const controls: Record<string, JSONValue> = {};
  if (parsed && Object.hasOwn(parsed, "thinking") && isJsonValue(parsed.thinking)) {
    controls.thinking = parsed.thinking;
  }
  if (parsed && Object.hasOwn(parsed, "reasoning_effort") && isJsonValue(parsed.reasoning_effort)) {
    controls.reasoning_effort = parsed.reasoning_effort;
  }
  if (parsed && Object.hasOwn(parsed, "output_config") && isJsonValue(parsed.output_config)) {
    controls.output_config = parsed.output_config;
  }
  return {
    ...summary,
    finalBodyControls: Object.keys(controls).length > 0 ? controls : null
  };
}

function parseRequestBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      return isPlainRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainRecord(body) ? body : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function buildSystem(role: "landlord" | "farmer"): string {
  const roleLabel = role === "landlord" ? "地主" : "农民";
  const lines = [
    `你是斗地主高手,当前是${roleLabel}。`,
    `一局三人:地主 1 人 对 农民 2 人;两个农民是一队、目标一致,要合力让地主出不完牌。`,
    `你会看到自己的完整手牌、各家身份/剩牌/公开明牌、上一手由谁打出,以及若干从 1 开始编号的合法出牌选项,只能从中选一个。`,
    `目标:打赢这一局——地主要尽快出完牌,农民要和队友配合拦截地主。`,
    role === "farmer"
      ? `农民策略倾向:跟地主牌时不要因牌小就默认过牌;若用低代价小牌可阻断地主连续清牌,要认真考虑接管牌权。若必须消耗2、王、炸弹或严重拆坏关键牌型,可以过牌。跟队友牌时通常不抢队友牌权,除非接手后收益明显更高。`
      : `地主策略倾向:优先减少手牌和保持出牌权;小牌可用于清理牌型,但要警惕农民用低代价接管牌权。`,
    `所有可见文字都必须使用简体中文;如模型支持独立思考通道,思考通道也必须使用简体中文简短分析。`,
    `快速判断后立刻给答案。最终回复只输出你选择的那个选项的编号数字(例如 2),不要复述牌型、不要解释、不要任何其它文字或标点。`
  ];
  return lines.join("");
}

export function formatMoveSelectionPrompt(ctx: MoveSelectionContext): string {
  const opponents = ctx.opponents.map(formatOpponentInfo).join(",");
  const options = ctx.candidates.map((label, index) => `${index + 1}: ${label}`).join("\n");
  // 手牌/已出都用分组计数(×N)如实呈现张数,不再额外报一个会和列表对不上的总数。
  const lines = [`你的手牌:${ctx.hand.join(" ")}`];
  if (ctx.turnOrder && ctx.turnOrder.length > 0) {
    lines.push(`出牌顺序:${ctx.turnOrder.map((item) => `${item.label}(${item.handCount}张)`).join(" -> ")}。`);
  }
  if (ctx.landlordCards && ctx.landlordCards.length > 0) {
    lines.push(`地主底牌:${ctx.landlordCards.join(" ")}。`);
  }
  // 本局已出是公开信息(桌上人人可见),供模型记牌、推断剩余;开局无人出牌时不赘述。
  if (ctx.playedCards.length > 0) {
    lines.push(`本局已出:${ctx.playedCards.join(" ")}。`);
  }
  if (ctx.unseenCards && ctx.unseenCards.length > 0) {
    lines.push(`未见牌:${ctx.unseenCards.join(" ")}。`);
  }
  if (ctx.recentActions && ctx.recentActions.length > 0) {
    lines.push(`最近动作:\n${ctx.recentActions.map((action, index) => `${index + 1}. ${formatRecentAction(action)}`).join("\n")}`);
  }
  const focus = decisionFocus(ctx);
  lines.push(
    `其他两家:${opponents}。`,
    ctx.lastPlay
      ? `上一手:${ctx.lastPlay.by}打出 ${ctx.lastPlay.description},现在轮到你跟牌(压得过可压、也可过牌)。`
      : `现在轮到你领出,可任意出牌。`,
    ...(focus ? [`本手重点:${focus}`] : []),
    `可选出牌(编号: 描述):`,
    options,
    `请选择最优的一手。如有独立思考通道,先用简体中文简短分析;最终只输出一个编号数字(1 到 ${ctx.candidates.length}),不要任何其它文字。`
  );
  return lines.join("\n");
}

function decisionFocus(ctx: MoveSelectionContext): string | null {
  if (!ctx.lastPlay) {
    return "你在领出。请优先比较一次能走掉多少张、剩余牌型是否顺畅、以及是否需要保留关键控制牌。";
  }
  if (ctx.role === "farmer" && ctx.lastPlay.by === "地主") {
    return "上一手来自地主。过牌会增加地主连续清牌和保持牌权的机会;请比较最小可压代价与放地主继续出牌的风险,不要只因为牌小就默认过。";
  }
  if (ctx.role === "farmer" && ctx.lastPlay.by === "队友") {
    return "上一手来自队友。农民之间以配合为先,通常不要无意义抢队友牌权;只有接手后能明显压制地主或更快走牌时再压。";
  }
  if (ctx.role === "landlord") {
    return "你在跟农民牌。请比较抢回牌权的收益、消耗控制牌的代价、以及过牌后农民继续配合走牌的风险。";
  }
  return null;
}

function formatOpponentInfo(opponent: OpponentInfo): string {
  const revealed =
    opponent.revealedCards.length > 0 ? `,明牌:${opponent.revealedCards.join(" ")}` : "";
  return `${opponent.label}剩 ${opponent.handCount} 张${revealed}`;
}

function formatRecentAction(action: RecentActionInfo): string {
  return action.action === "pass" ? `${action.by}: 不要` : `${action.by}: ${action.description ?? "出牌"}`;
}
