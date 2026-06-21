import { z } from "zod";

/**
 * 归一化后的供应商类型,决定走哪个 AI SDK 适配器:
 * - anthropic:原生 @ai-sdk/anthropic(effort / thinking 关闭)。
 * - deepseek:DeepSeek 官方 OpenAI-compatible 接口 + V4 thinking/reasoning_effort 注入。
 * - mimo:MiMo 官方 OpenAI-compatible 接口 + thinking 开关注入。
 * - openai-compatible:其余一律走 @ai-sdk/openai-compatible(OpenAI / OpenRouter / 本地服务等)。
 */
export type ProviderType = "anthropic" | "openai-compatible" | "deepseek" | "mimo";

/** 一个 provider+model 选择(无密钥):前端下拉与房间决策都用它表达「选哪个模型」。 */
export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

/** 归一化后的单个供应商配置(含密钥,仅服务端持有,绝不下发前端)。 */
export interface ProviderConfig {
  readonly type: ProviderType;
  readonly apiKey?: string | undefined;
  readonly baseURL?: string | undefined;
  readonly models: readonly string[];
  /** 可选展示名,前端下拉分组用;缺省回退 provider key。 */
  readonly label?: string | undefined;
}

/** 机器人供应商注册表:default 指向一个合法模型,providers 持有各家配置与密钥。 */
export interface BotProviderRegistry {
  readonly default: ModelRef;
  readonly providers: Readonly<Record<string, ProviderConfig>>;
}

/** 前端下拉用的扁平模型项(无密钥)。 */
export interface ModelOption {
  readonly provider: string;
  readonly model: string;
  /** provider 展示名(label 或 provider key)。 */
  readonly providerLabel: string;
}

// 配置文件按用户习惯用 snake_case;已知 type 走专用适配分支,缺省/未知 type 视为 openai-compatible。
const rawProviderSchema = z.object({
  type: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  models: z.array(z.string().min(1)).min(1),
  label: z.string().min(1).optional()
});

const rawRegistrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  providers: z.record(z.string().min(1), rawProviderSchema)
});

type RawRegistry = z.infer<typeof rawRegistrySchema>;
type RawProvider = z.infer<typeof rawProviderSchema>;

// 无配置文件时合成的默认 Anthropic 模型列表(向后兼容旧的 ANTHROPIC_API_KEY 用法)。
const DEFAULT_ANTHROPIC_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"] as const;
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

/**
 * 解析机器人供应商注册表(纯函数,不读文件——IO 交给调用方,便于测试)。
 * - raw 为 JSON 字符串:按 snake_case 配置解析并归一化;default 指向非法模型时回退首个可用模型。
 * - raw 为 null/空:用 env.ANTHROPIC_API_KEY 合成单 anthropic 供应商,向后兼容旧 .env 用法。
 * 解析失败(JSON 非法/schema 不符)直接抛错——配置写错应当在启动时显式失败,而不是静默吞掉。
 */
export function parseBotProviderRegistry(
  raw: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): BotProviderRegistry {
  if (raw && raw.trim()) {
    return normalize(rawRegistrySchema.parse(JSON.parse(raw)));
  }
  const envModel = env.BOT_DECISION_MODEL;
  const model =
    envModel && (DEFAULT_ANTHROPIC_MODELS as readonly string[]).includes(envModel) ? envModel : DEFAULT_ANTHROPIC_MODEL;
  return {
    default: { provider: "anthropic", model },
    providers: {
      anthropic: {
        type: "anthropic",
        apiKey: env.ANTHROPIC_API_KEY,
        models: [...DEFAULT_ANTHROPIC_MODELS],
        label: "Anthropic"
      }
    }
  };
}

function normalize(parsed: RawRegistry): BotProviderRegistry {
  const providers: Record<string, ProviderConfig> = {};
  for (const [name, raw] of Object.entries(parsed.providers)) {
    providers[name] = {
      type: normalizeProviderType(name, raw),
      apiKey: raw.api_key,
      baseURL: raw.base_url,
      models: raw.models,
      label: raw.label
    };
  }
  const declared: ModelRef = { provider: parsed.provider, model: parsed.model };
  const registry: BotProviderRegistry = { default: declared, providers };
  // 声明的默认模型必须真实存在;否则回退到首个可用模型,保证 registry.default 永远可解析。
  const fallback = isAllowedModel(registry, declared) ? declared : firstModelRef(providers);
  return { default: fallback ?? declared, providers };
}

function normalizeProviderType(name: string, raw: RawProvider): ProviderType {
  const specializedType = detectSpecializedProviderType(name, raw);
  if (specializedType && raw.type !== specializedType) {
    throw new Error(
      `Provider "${name}" looks like ${specializedType}, but type is "${raw.type ?? "(missing)"}". ` +
        `Set type to "${specializedType}" so provider-specific thinking controls are applied.`
    );
  }

  return raw.type === "anthropic" || raw.type === "deepseek" || raw.type === "mimo"
    ? raw.type
    : "openai-compatible";
}

function detectSpecializedProviderType(name: string, raw: RawProvider): "anthropic" | "deepseek" | "mimo" | null {
  const providerName = name.toLowerCase();
  const baseURL = raw.base_url?.toLowerCase() ?? "";

  if (providerName === "anthropic" || baseURL.includes("anthropic.com")) {
    return "anthropic";
  }

  if (
    providerName === "mimo" ||
    baseURL.includes("xiaomimimo.com")
  ) {
    return "mimo";
  }

  if (
    providerName === "deepseek" ||
    baseURL.includes("deepseek.com")
  ) {
    return "deepseek";
  }

  return null;
}

function firstModelRef(providers: Readonly<Record<string, ProviderConfig>>): ModelRef | null {
  for (const [provider, config] of Object.entries(providers)) {
    const model = config.models.at(0);
    if (model) {
      return { provider, model };
    }
  }
  return null;
}

/** ref 指向的 provider/model 是否在注册表内(决策入口校验客户端传值用)。 */
export function isAllowedModel(registry: BotProviderRegistry, ref: ModelRef): boolean {
  return registry.providers[ref.provider]?.models.includes(ref.model) ?? false;
}

/** 扁平列出所有模型(无密钥),供 /bot-models 下发前端。 */
export function listModels(registry: BotProviderRegistry): ModelOption[] {
  return Object.entries(registry.providers).flatMap(([provider, config]) =>
    config.models.map((model) => ({ provider, model, providerLabel: config.label ?? provider }))
  );
}
