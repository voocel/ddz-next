import { streamText, type JSONValue, type LanguageModel } from "ai";

/** 其他一家:相对自己的身份(地主/队友/农民)+ 剩牌数。 */
export interface OpponentInfo {
  readonly label: string;
  readonly handCount: number;
}

/** 上一手:由谁(按角色)打出的什么牌型。 */
export interface LastPlayInfo {
  /** 打出者相对自己的身份,如「地主」「队友」「农民」。 */
  readonly by: string;
  /** 牌型描述,如「对子7」。 */
  readonly description: string;
}

/**
 * 选牌所需的公开局势 + 候选走法(由调用方从快照映射,bot-ai 不依赖游戏内部类型)。
 * 刻意给足农民/地主决策所需的事实:自己的完整手牌、本局已出的牌、各家身份+剩牌、上一手由谁打出——
 * 但不灌输策略(出什么由模型自己定),以如实验证模型牌力。
 * candidates 是带编号的中文走法标签,索引即选择值;过牌等特殊选项也由调用方放进列表。
 */
export interface MoveSelectionContext {
  readonly role: "landlord" | "farmer";
  /** 自己的完整手牌(按从小到大分组的中文描述,如 ["3","5×2","J","2×2"]),供模型规划。 */
  readonly hand: readonly string[];
  /**
   * 本局已出的牌(按从小到大分组的中文,如 ["3×2","K","大王"])。公开信息、桌上人人可见,
   * 给模型用于记牌、推断各点数还剩多少未现——这是事实而非策略。开局领出、本局尚无人出牌时为空数组。
   */
  readonly playedCards: readonly string[];
  /** 其他两家,按座位顺序;含身份标签,农民据此分辨地主与队友。 */
  readonly opponents: readonly OpponentInfo[];
  /** 上一手由谁打出的什么;轮到领出时为 null。 */
  readonly lastPlay: LastPlayInfo | null;
  /** 候选走法标签,至少一项;模型只能在 [0, candidates.length) 中选索引。 */
  readonly candidates: readonly string[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderRequestSummary {
  readonly providerOptions: Record<string, Record<string, JSONValue>> | null;
  readonly deepseekControls: Record<string, JSONValue> | null;
  readonly finalBodyControls: Record<string, JSONValue> | null;
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
  /** abort/API/网络错误的消息;成功为 null。错误已被捕获进 trace,但调用方仍应据此抛错暴露(不静默)。 */
  readonly error: string | null;
  readonly errorStack: string | null;
}

export interface MoveDecision {
  /** 解析出的合法候选编号;模型有响应但解析不出/越界,或请求出错时为 null。 */
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
    const prompt = buildPrompt(ctx);
    const modelId = typeof model === "string" ? model : (model.modelId ?? null);
    const requestSummary = summarizeRequest(this.options.providerOptions);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // 三条刻意的选择:
    // 1) 把 API/超时/网络错误捕获进 trace.error(而非直接抛),好连同 system/prompt 一起留证;
    //    异常本身仍由调用方据 trace.error 抛错暴露(见 LlmBotBrain),不静默。
    // 2) 不用强制 tool_choice——很多推理模型(deepseek-v4-pro、o1 类)不支持强制工具调用,
    //    改用最通用的「只回复编号数字」纯文本输出,跨 provider 一致;模型有响应但解析不出有效编号时 index=null。
    // 3) 用 streamText 而非 generateText:遍历 fullStream 实时把 reasoning/text 增量回调给 streamHooks(牌桌 AI 输出流);
    //    error part 显式捕获 + allSettled 收尾(消费所有 promise 拒绝,既不静默错误也不留未处理拒绝)。
    try {
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
          error: null,
          errorStack: null
        }
      };
    } catch (error) {
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
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? (error.stack ?? null) : null
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 从模型回复中解析出落在 [0, count) 的整数编号。导出供单测。
 * - number:直接校验范围。
 * - string:纯数字直接用;夹带解释时取文本里第一个落在范围内的整数(prompt 已要求只回数字,这是兜底)。
 * 解析不出有效编号返回 null(由调用方按「模型未给出有效选择」处理)。
 */
export function parseMoveIndex(raw: unknown, count: number): number | null {
  let value: number | null = null;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      value = Number(trimmed);
    } else {
      for (const match of trimmed.match(/\d+/g) ?? []) {
        const candidate = Number(match);
        if (Number.isInteger(candidate) && candidate >= 0 && candidate < count) {
          value = candidate;
          break;
        }
      }
    }
  }
  if (value === null || !Number.isInteger(value) || value < 0 || value >= count) {
    return null;
  }
  return value;
}

function toUsage(
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined
): TokenUsage | null {
  if (!usage || typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") {
    return null;
  }
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

function summarizeRequest(providerOptions: Record<string, Record<string, JSONValue>> | undefined): ProviderRequestSummary {
  const deepseek = providerOptions?.deepseek;
  const controls: Record<string, JSONValue> = {};
  if (deepseek && Object.hasOwn(deepseek, "thinking")) {
    const thinking = deepseek.thinking;
    if (thinking !== undefined) {
      controls.thinking = thinking;
    }
  }
  if (deepseek && Object.hasOwn(deepseek, "reasoning_effort")) {
    const reasoningEffort = deepseek.reasoning_effort;
    if (reasoningEffort !== undefined) {
      controls.reasoning_effort = reasoningEffort;
    }
  }
  return {
    providerOptions: providerOptions ?? null,
    deepseekControls: Object.keys(controls).length > 0 ? controls : null,
    finalBodyControls: null
  };
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
  return [
    `你是斗地主高手,当前是${roleLabel}。`,
    `一局三人:地主 1 人 对 农民 2 人;两个农民是一队、目标一致,要合力让地主出不完牌。`,
    `你会看到自己的完整手牌、各家身份与剩牌、上一手由谁打出,以及若干编号的合法出牌选项,只能从中选一个。`,
    `目标:打赢这一局——地主要尽快出完牌,农民要和队友配合拦截地主。`,
    `快速判断后立刻给答案。只回复你选择的那个选项的编号数字(例如 2),不要复述牌型、不要解释、不要输出分析、不要任何其它文字或标点。`
  ].join("");
}

function buildPrompt(ctx: MoveSelectionContext): string {
  const opponents = ctx.opponents.map((opponent) => `${opponent.label}剩 ${opponent.handCount} 张`).join(",");
  const options = ctx.candidates.map((label, index) => `${index}: ${label}`).join("\n");
  // 手牌/已出都用分组计数(×N)如实呈现张数,不再额外报一个会和列表对不上的总数。
  const lines = [`你的手牌:${ctx.hand.join(" ")}`];
  // 本局已出是公开信息(桌上人人可见),供模型记牌、推断剩余;开局无人出牌时不赘述。
  if (ctx.playedCards.length > 0) {
    lines.push(`本局已出:${ctx.playedCards.join(" ")}。`);
  }
  lines.push(
    `其他两家:${opponents}。`,
    ctx.lastPlay
      ? `上一手:${ctx.lastPlay.by}打出 ${ctx.lastPlay.description},现在轮到你跟牌(压得过可压、也可过牌)。`
      : `现在轮到你领出,可任意出牌。`,
    `可选出牌(编号: 描述):`,
    options,
    `请选择最优的一手,最终只输出一个编号数字(0 到 ${ctx.candidates.length - 1}),不要任何其它文字。`
  );
  return lines.join("\n");
}
