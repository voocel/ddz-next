import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { BotProviderRegistry, ModelRef } from "./registry.js";
import { buildDeepSeekRequestControls, buildMiMoRequestControls, type ReasoningEffort } from "./reasoning.js";

export interface ResolveModelOptions {
  readonly reasoningEffort?: ReasoningEffort | undefined;
}

/**
 * 把 {provider, model} 解析成 AI SDK 语言模型。
 * provider/model 不在注册表、缺密钥(anthropic 可回退环境变量 ANTHROPIC_API_KEY)、
 * 或 openai-compatible 缺 baseURL 时返回 null。如何处理由调用方决定:
 * 决策路径(createBotBrain)缺配置直接抛错暴露、绝不回退规则 bot;解说路径(LlmCommentator)静默关闭。
 */
export function resolveModel(
  ref: ModelRef,
  registry: BotProviderRegistry,
  options: ResolveModelOptions = {}
): LanguageModel | null {
  const provider = registry.providers[ref.provider];
  if (!provider || !provider.models.includes(ref.model)) {
    return null;
  }

  if (provider.type === "anthropic") {
    const apiKey = provider.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }
    const fetch = createLlmHttpDebugFetch(ref.provider, ref.model);
    return createAnthropic({
      apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
      ...(fetch ? { fetch } : {})
    })(ref.model);
  }

  // 当前 ai@5 只能接 LanguageModelV2；支持 DeepSeek V4 thinking 的 @ai-sdk/deepseek@2 是 V3 模型，
  // 不能直接混用。这里用 openai-compatible 适配器，并在 transformRequestBody 最后一跳写入官方
  // OpenAI 格式的 thinking/reasoning_effort，确保 DeepSeek V4 思考开关真实落到请求体。
  if (provider.type === "deepseek") {
    if (!provider.apiKey) {
      return null;
    }
    const fetch = createLlmHttpDebugFetch(ref.provider, ref.model);
    const requestControls = options.reasoningEffort
      ? buildDeepSeekRequestControls(options.reasoningEffort)
      : undefined;
    return createOpenAICompatible({
      name: "deepseek",
      apiKey: provider.apiKey,
      baseURL: provider.baseURL ?? "https://api.deepseek.com",
      ...(fetch ? { fetch } : {}),
      ...(requestControls
        ? {
            transformRequestBody: (args) => ({
              ...args,
              ...requestControls
            })
          }
        : {})
    })(ref.model);
  }

  if (provider.type === "mimo") {
    if (!provider.apiKey || !provider.baseURL) {
      return null;
    }
    const fetch = createLlmHttpDebugFetch(ref.provider, ref.model);
    // MiMo 的思考控制不是通用 reasoningEffort,而是官方 OpenAI-compatible 扩展字段:
    // 顶层 `thinking:{"type":"enabled"|"disabled"}`。这里与 DeepSeek 一样在最终请求体落地。
    const requestControls = options.reasoningEffort
      ? buildMiMoRequestControls(options.reasoningEffort)
      : undefined;
    return createOpenAICompatible({
      name: "mimo",
      apiKey: provider.apiKey,
      headers: { "api-key": provider.apiKey },
      baseURL: provider.baseURL,
      ...(fetch ? { fetch } : {}),
      ...(requestControls
        ? {
            transformRequestBody: (args) => ({
              ...args,
              ...requestControls
            })
          }
        : {})
    })(ref.model);
  }

  // openai-compatible:deepseek / openrouter / 本地服务等,必须同时有 apiKey + baseURL。
  if (!provider.apiKey || !provider.baseURL) {
    return null;
  }
  const fetch = createLlmHttpDebugFetch(ref.provider, ref.model);
  return createOpenAICompatible({
    name: ref.provider,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    ...(fetch ? { fetch } : {})
  })(ref.model);
}

const HTTP_DEBUG_PREVIEW_CHARS = 12_000;

function createLlmHttpDebugFetch(provider: string, model: string): typeof globalThis.fetch | undefined {
  if (process.env.BOT_LLM_HTTP_DEBUG !== "true") {
    return undefined;
  }

  return async (input, init) => {
    const started = Date.now();
    const url = inputUrl(input);
    console.warn(
      "[llm-http-debug] request",
      JSON.stringify(
        {
          provider,
          model,
          url,
          request: summarizeRequest(init)
        },
        null,
        2
      )
    );

    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch (error) {
      console.warn(
        "[llm-http-debug] fetch_error",
        JSON.stringify({ provider, model, url, latencyMs: Date.now() - started, error: errorMessage(error) }, null, 2)
      );
      throw error;
    }

    const latencyMs = Date.now() - started;
    const clone = response.clone();
    void clone
      .text()
      .then((body) => {
        console.warn(
          "[llm-http-debug] response",
          JSON.stringify(
            {
              provider,
              model,
              url,
              latencyMs,
              status: response.status,
              statusText: response.statusText,
              headers: safeHeaders(response.headers),
              bodyLength: body.length,
              bodyPreview: body.slice(0, HTTP_DEBUG_PREVIEW_CHARS),
              truncated: body.length > HTTP_DEBUG_PREVIEW_CHARS
            },
            null,
            2
          )
        );
      })
      .catch((error: unknown) => {
        console.warn(
          "[llm-http-debug] response_read_error",
          JSON.stringify({ provider, model, url, latencyMs, error: errorMessage(error) }, null, 2)
        );
      });

    return response;
  };
}

function inputUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function summarizeRequest(init: Parameters<typeof globalThis.fetch>[1]): Record<string, unknown> {
  return {
    method: init?.method,
    headers: safeHeaders(init?.headers),
    body: summarizeRequestBody(init?.body)
  };
}

function summarizeRequestBody(body: RequestInit["body"] | null | undefined): unknown {
  if (typeof body !== "string") {
    return typeof body;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) {
      return { rawPreview: body.slice(0, 500) };
    }
    return summarizeJsonRequestBody(parsed);
  } catch {
    return { rawPreview: body.slice(0, 500) };
  }
}

function summarizeJsonRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of [
    "model",
    "stream",
    "max_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "top_k",
    "thinking",
    "reasoning_effort"
  ]) {
    if (Object.hasOwn(body, key)) {
      summary[key] = body[key];
    }
  }
  if (Array.isArray(body.messages)) {
    summary.messages = body.messages.map((message) =>
      isRecord(message)
        ? {
            role: message.role,
            content: summarizeContent(message.content)
          }
        : typeof message
    );
  }
  if (Object.hasOwn(body, "system")) {
    summary.system = summarizeContent(body.system);
  }
  return summary;
}

function summarizeContent(content: unknown): unknown {
  if (typeof content === "string") {
    return { type: "string", length: content.length, preview: content.slice(0, 300) };
  }
  if (Array.isArray(content)) {
    return { type: "array", length: content.length };
  }
  return typeof content;
}

function safeHeaders(headers: RequestInit["headers"] | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of new Headers(headers)) {
    if (isSensitiveHeader(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isSensitiveHeader(key: string): boolean {
  return ["authorization", "x-api-key", "api-key", "cookie", "set-cookie"].includes(key.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
