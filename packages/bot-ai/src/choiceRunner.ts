import { streamText, type JSONValue, type LanguageModel } from "ai";
import {
  createLlmHttpTraceScope,
  finishLlmHttpTraceScope,
  runWithLlmHttpTraceScope,
  type LlmHttpTrace
} from "./httpTrace.js";

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

export interface LlmChoiceRunnerOptions {
  /** 已由供应商注册表解析好的语言模型;为 null(缺密钥/未配置)时直接返回 null,不发起请求。 */
  readonly model: LanguageModel | null;
  /** 流静默超时:超过该时长没有任何流增量才中止;总时长另有其 5 倍的硬上限。 */
  readonly timeoutMs?: number;
  /** 输出 token 上限;缺省按 provider 类型取默认(deepseek 65536,其余 16384),见 resolveMaxOutputTokens。 */
  readonly maxOutputTokens?: number;
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

/** 一次「候选编号选择」请求:调用方负责组好 system/prompt,runner 只管发请求与解析编号。 */
export interface ChoiceRequest {
  readonly system: string;
  readonly prompt: string;
  /** 候选项数量;模型回复的展示编号必须落在 1..candidateCount。 */
  readonly candidateCount: number;
  /** 候选标签原文(与编号同序);模型夹带解释时先按标签唯一命中解析,再退数字提取。 */
  readonly candidateLabels?: readonly string[];
}

// 与 config.ts 的 DEFAULT_DECISION_TIMEOUT_MS 对齐:推理模型单步思考偏慢,给足头寸(生产路径总会显式传 timeoutMs)。
const DEFAULT_TIMEOUT_MS = 60_000;
// 总时长硬上限 = 静默超时 × 5:思考型模型持续流式吐 reasoning 时静默计时不会触发,
// 总时长由输出 token 上限(resolveMaxOutputTokens)与这条硬上限双兜底,防病态慢流占死牌桌。
const TOTAL_TIMEOUT_MULTIPLIER = 5;
// 推理/thinking 模型的「思考」也算进 output token,必须留足空间——deepseek-v4 开思考(默认 effort high)
// 复杂局面思维链可烧穿 8192 导致 finishReason=length 且最终编号未输出(实测事故)。
// 官方 DeepSeek V4 输出硬顶 384K,给 65536 足够任何一手思考;其它 provider(Anthropic/中转等)
// 输出上限普遍在 16K~64K 之间,取 16384(NVIDIA 对 v4-flash 的示例默认值)保守兼容。
// 普通模型按 prompt「只回复一个数字」会很快停,不会用满;总时长硬上限另兜底运行时长。
const DEEPSEEK_MAX_OUTPUT_TOKENS = 65_536;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

function resolveMaxOutputTokens(options: LlmChoiceRunnerOptions): number {
  return options.maxOutputTokens ?? (options.provider?.type === "deepseek" ? DEEPSEEK_MAX_OUTPUT_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS);
}

/**
 * 候选编号制 LLM 请求管线:流式请求、reasoning/text 增量回调、编号解析、全量 trace 留证。
 * 出牌(LlmMoveChooser)与叫抢(LlmBidChooser)共用这一份实现,prompt 内容由各自组装。
 */
export class LlmChoiceRunner {
  constructor(private readonly options: LlmChoiceRunnerOptions) {}

  async run(request: ChoiceRequest, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null> {
    const model = this.options.model;
    if (request.candidateCount <= 0 || !model) {
      return null;
    }

    const { system, prompt } = request;
    const modelId = typeof model === "string" ? model : (model.modelId ?? null);
    const requestSummary = summarizeRequest(this.options.providerOptions, this.options.provider);

    const controller = new AbortController();
    // 超时按「流静默」计:思考型模型(deepseek thinking 等)最终编号前会长时间流式吐 reasoning,
    // 按总时长掐死会把健康的长思考误杀成失败——只要还有增量就续期,静默才中止;总时长仍留硬上限。
    const idleTimeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const totalTimeoutMs = idleTimeoutMs * TOTAL_TIMEOUT_MULTIPLIER;
    let abortReason: string | null = null;
    const abortWith = (reason: string): void => {
      abortReason = reason;
      controller.abort();
    };
    let idleTimer = setTimeout(() => abortWith(`LLM 流静默超过 ${idleTimeoutMs}ms`), idleTimeoutMs);
    const totalTimer = setTimeout(() => abortWith(`LLM 请求总时长超过 ${totalTimeoutMs}ms`), totalTimeoutMs);
    const touchIdleTimer = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abortWith(`LLM 流静默超过 ${idleTimeoutMs}ms`), idleTimeoutMs);
    };
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
        maxOutputTokens: resolveMaxOutputTokens(this.options),
        abortSignal: controller.signal,
        ...(this.options.providerOptions ? { providerOptions: this.options.providerOptions } : {})
      });

      let streamError: unknown = null;
      for await (const part of result.fullStream) {
        touchIdleTimer();
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
        index: parseMoveIndex(text, request.candidateCount, request.candidateLabels),
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
      // 我们主动 abort 时,SDK 抛的是含混的 NoOutputGeneratedError/AbortError——替换成中止真因(静默/总时长超时)。
      const cause = abortReason !== null ? new Error(`${abortReason},已中止请求`) : error;
      const errorInfo = toRequestErrorInfo(cause);
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
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
    }
  }
}

/**
 * 从模型回复中解析出展示编号(1..count),再映射为内部 0 基索引。导出供单测。
 * - number:按展示编号校验范围。
 * - string:纯数字直接用;夹带解释时**先按候选标签唯一命中解析**,再退「取第一个落在展示范围内的整数」。
 *   标签优先是因为斗地主文本里 2~10 都是牌名——如「仅双王及2,不抢」抽数字会把牌名 2 当编号,
 *   而结论里逐字出现的标签(不抢/叫地主/过牌…)才是模型意图;多个标签同时命中视为歧义,退回数字提取。
 * 解析不出有效编号返回 null(由调用方按「模型未给出有效选择」处理)。
 */
export function parseMoveIndex(raw: unknown, count: number, labels?: readonly string[]): number | null {
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
      const labelIndex = matchUniqueLabel(trimmed, labels, count);
      if (labelIndex !== null) {
        return labelIndex;
      }
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

/** 回复文本里逐字且唯一出现的候选标签 → 其 0 基索引;零命中或多命中(歧义)返回 null。 */
function matchUniqueLabel(text: string, labels: readonly string[] | undefined, count: number): number | null {
  if (!labels || labels.length !== count) {
    return null;
  }
  let matched: number | null = null;
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (!label || !text.includes(label)) {
      continue;
    }
    if (matched !== null) {
      return null;
    }
    matched = index;
  }
  return matched;
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
  provider: LlmChoiceRunnerOptions["provider"]
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

function summarizeProvider(provider: LlmChoiceRunnerOptions["provider"]): ProviderRequestSummary["provider"] {
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
