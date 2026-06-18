import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { BotProviderRegistry, ModelRef } from "./registry.js";

/**
 * 把 {provider, model} 解析成 AI SDK 语言模型。
 * provider/model 不在注册表、缺密钥(anthropic 可回退环境变量 ANTHROPIC_API_KEY)、
 * 或 openai-compatible 缺 baseURL 时返回 null,由调用方静默降级(回退规则 bot)。
 */
export function resolveModel(ref: ModelRef, registry: BotProviderRegistry): LanguageModel | null {
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
