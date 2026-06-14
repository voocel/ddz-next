/** 音频音量偏好：music/sfx 各为 0..1 的倍率，0 即静音。持久化到 localStorage。 */
export interface AudioLevels {
  readonly music: number;
  readonly sfx: number;
}

const STORAGE_KEY = "ddz-audio";
export const DEFAULT_AUDIO_LEVELS: AudioLevels = { music: 1, sfx: 1 };

function clamp01(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** 把存储的原始字符串解析成夹到 0..1 的音量；空/损坏/越界都安全回退（纯函数，便于单测）。 */
export function parseAudioLevels(raw: string | null): AudioLevels {
  if (!raw) {
    return DEFAULT_AUDIO_LEVELS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AudioLevels>;
    return { music: clamp01(parsed.music), sfx: clamp01(parsed.sfx) };
  } catch {
    return DEFAULT_AUDIO_LEVELS;
  }
}

export function loadAudioLevels(): AudioLevels {
  try {
    return parseAudioLevels(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_AUDIO_LEVELS;
  }
}

export function saveAudioLevels(levels: AudioLevels): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
  } catch {
    // 存储不可用时静默忽略，音量仅本次会话生效
  }
}
