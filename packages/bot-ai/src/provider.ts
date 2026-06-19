import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { BotProviderRegistry, ModelRef } from "./registry.js";
import { buildDeepSeekRequestControls, type ReasoningEffort } from "./reasoning.js";

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
    return createAnthropic({ apiKey, ...(provider.baseURL ? { baseURL: provider.baseURL } : {}) })(ref.model);
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
    baseURL: provider.baseURL
  })(ref.model);
}
