/**
 * 思考强度档位:off 关闭(默认)、auto 跟随模型、low/medium/high。
 * 与服务端 @ddz/bot-ai 的 ReasoningEffort 取值一致(本地声明以保持 web 不依赖服务端包;
 * 服务端 parseReasoningEffort 仍是校验权威,非法值回退 auto)。
 */
export type ReasoningEffort = "auto" | "off" | "low" | "medium" | "high";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["auto", "off", "low", "medium", "high"];

/**
 * 「AI 对战」机器人偏好:选定的 provider + model + 思考强度(API key 始终在服务端,前端永不接触)。
 * provider/model 皆空表示「用服务端默认模型」;具体可选项由 game-server 的 /bot-models 动态下发。
 * 偏好不在前端做白名单校验——服务端会按注册表校验。建房初始值非法时回退默认；牌桌内热更新非法时显式拒绝。
 * 持久化到 localStorage。
 */
export interface BotPreferences {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

const STORAGE_KEY = "ddz-bot";
const STORAGE_VERSION = 2;
export const DEFAULT_BOT_PREFERENCES: BotPreferences = { provider: "", model: "", reasoningEffort: "off" };

/** 把存储的原始字符串解析成偏好;空/损坏/缺字段都安全回退默认(纯函数,便于单测)。 */
export function parseBotPreferences(raw: string | null): BotPreferences {
  if (!raw) {
    return DEFAULT_BOT_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BotPreferences> & { version?: unknown };
    if (typeof parsed.provider !== "string" || typeof parsed.model !== "string") {
      return DEFAULT_BOT_PREFERENCES;
    }
    let reasoningEffort =
      typeof parsed.reasoningEffort === "string" && (REASONING_EFFORTS as readonly string[]).includes(parsed.reasoningEffort)
        ? (parsed.reasoningEffort as ReasoningEffort)
        : DEFAULT_BOT_PREFERENCES.reasoningEffort;
    // v1 的默认值是 auto,很多浏览器会在用户未主动选择时保存下来；迁移为 off,避免 DeepSeek 默认长思考。
    if (parsed.version !== STORAGE_VERSION && reasoningEffort === "auto") {
      reasoningEffort = DEFAULT_BOT_PREFERENCES.reasoningEffort;
    }
    return { provider: parsed.provider, model: parsed.model, reasoningEffort };
  } catch {
    return DEFAULT_BOT_PREFERENCES;
  }
}

export function loadBotPreferences(): BotPreferences {
  try {
    return parseBotPreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_BOT_PREFERENCES;
  }
}

export function saveBotPreferences(preferences: BotPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, version: STORAGE_VERSION }));
  } catch {
    // 存储不可用时静默忽略，偏好仅本次会话生效
  }
}
