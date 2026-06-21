import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { BotProviderRegistry, ModelRef } from "./registry.js";
import { buildDeepSeekRequestControls, buildMiMoRequestControls, type ReasoningEffort } from "./reasoning.js";
import { currentLlmHttpTraceScope, type LlmHttpTraceEntry } from "./httpTrace.js";

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
    const headers = buildAnthropicHeaders(provider);
    return createAnthropic({
      apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
      ...(headers ? { headers } : {}),
      fetch: createLlmTraceFetch(ref.provider, ref.model)
    })(ref.model);
  }

  // 当前 ai@5 只能接 LanguageModelV2；支持 DeepSeek V4 thinking 的 @ai-sdk/deepseek@2 是 V3 模型，
  // 不能直接混用。这里用 openai-compatible 适配器，并在 transformRequestBody 最后一跳写入官方
  // OpenAI 格式的 thinking/reasoning_effort，确保 DeepSeek V4 思考开关真实落到请求体。
  if (provider.type === "deepseek") {
    if (!provider.apiKey) {
      return null;
    }
    const requestControls = options.reasoningEffort
      ? buildDeepSeekRequestControls(options.reasoningEffort)
      : undefined;
    return createOpenAICompatible({
      name: "deepseek",
      apiKey: provider.apiKey,
      baseURL: provider.baseURL ?? "https://api.deepseek.com",
      fetch: createLlmTraceFetch(ref.provider, ref.model),
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
      fetch: createLlmTraceFetch(ref.provider, ref.model),
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
  return createOpenAICompatible({
    name: ref.provider,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    fetch: createLlmTraceFetch(ref.provider, ref.model)
  })(ref.model);
}

function createLlmTraceFetch(provider: string, model: string): typeof globalThis.fetch {
  return async (input, init) => {
    const started = Date.now();
    const url = inputUrl(input);
    const scope = currentLlmHttpTraceScope();
    const entries = scope?.entries;
    const pending = scope?.pending;
    const request = summarizeRequest(init);
    const entry: LlmHttpTraceEntry | null = scope
      ? {
          provider,
          model,
          url,
          request,
          response: null,
          responseReadError: null,
          error: null,
          latencyMs: null
        }
      : null;
    if (entry) {
      entries?.push(entry);
    }
    if (process.env.BOT_LLM_HTTP_DEBUG === "true") {
      console.warn("[llm-http-debug] request", JSON.stringify({ provider, model, url, request }, null, 2));
    }

    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (entry) {
        entry.latencyMs = latencyMs;
        entry.error = errorMessage(error);
      }
      if (process.env.BOT_LLM_HTTP_DEBUG === "true") {
        console.warn(
          "[llm-http-debug] fetch_error",
          JSON.stringify({ provider, model, url, latencyMs, error: errorMessage(error) }, null, 2)
        );
      }
      throw error;
    }

    const latencyMs = Date.now() - started;
    if (entry) {
      entry.latencyMs = latencyMs;
    }
    const clone = response.clone();
    const responseCapture = clone
      .text()
      .then((body) => {
        const headers = safeHeaders(response.headers) ?? {};
        if (entry) {
          entry.response = {
            status: response.status,
            statusText: response.statusText,
            headers,
            body,
            bodyLength: body.length
          };
        }
        if (process.env.BOT_LLM_HTTP_DEBUG === "true") {
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
                headers,
                bodyLength: body.length,
                body
              },
              null,
              2
            )
          );
        }
      })
      .catch((error: unknown) => {
        if (entry) {
          entry.responseReadError = errorMessage(error);
        }
        if (process.env.BOT_LLM_HTTP_DEBUG === "true") {
          console.warn(
            "[llm-http-debug] response_read_error",
            JSON.stringify({ provider, model, url, latencyMs, error: errorMessage(error) }, null, 2)
          );
        }
      });
    pending?.push(responseCapture);

    return response;
  };
}

function buildAnthropicHeaders(provider: BotProviderRegistry["providers"][string]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (provider.userAgent?.trim()) {
    headers["User-Agent"] = provider.userAgent.trim();
  }
  const beta = anthropicBetaHeader(provider.anthropicBeta);
  if (beta) {
    headers["anthropic-beta"] = beta;
  }
  for (const [key, value] of Object.entries(provider.headers ?? {})) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (normalizedKey && normalizedValue) {
      headers[normalizedKey] = normalizedValue;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function anthropicBetaHeader(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  const values = (value ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values.join(",") : null;
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

function summarizeRequest(init: Parameters<typeof globalThis.fetch>[1]): LlmHttpTraceEntry["request"] {
  return {
    method: init?.method ?? null,
    headers: safeHeaders(init?.headers) ?? null,
    body: typeof init?.body === "string" ? init.body : null
  };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
