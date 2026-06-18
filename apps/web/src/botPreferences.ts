/**
 * 「AI 对战」机器人偏好:选定的 provider + model(API key 始终在服务端,前端永不接触)。
 * 两者皆空表示「用服务端默认模型」;具体可选项由 game-server 的 /bot-models 动态下发。
 * 偏好不在前端做白名单校验——服务端 onCreate 会按注册表校验,非法值自动回退默认。持久化到 localStorage。
 */
export interface BotPreferences {
  readonly provider: string;
  readonly model: string;
}

const STORAGE_KEY = "ddz-bot";
export const DEFAULT_BOT_PREFERENCES: BotPreferences = { provider: "", model: "" };

/** 把存储的原始字符串解析成偏好;空/损坏/缺字段都安全回退默认(纯函数,便于单测)。 */
export function parseBotPreferences(raw: string | null): BotPreferences {
  if (!raw) {
    return DEFAULT_BOT_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BotPreferences>;
    if (typeof parsed.provider !== "string" || typeof parsed.model !== "string") {
      return DEFAULT_BOT_PREFERENCES;
    }
    return { provider: parsed.provider, model: parsed.model };
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 存储不可用时静默忽略，偏好仅本次会话生效
  }
}
