export const THEMES = [
  { id: "cartoon", label: "欢乐卡通" },
  { id: "pixel", label: "田园像素" }
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "ddz-theme";
const DEFAULT_THEME: ThemeId = "cartoon";

export function themeAsset(theme: ThemeId, file: string): string {
  return `/assets/images/themes/${theme}/${file}`;
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function loadTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存储不可用时静默忽略，主题仅本次会话生效
  }
}

export function nextTheme(current: ThemeId): ThemeId {
  const index = THEMES.findIndex((theme) => theme.id === current);
  return THEMES[(index + 1) % THEMES.length]!.id;
}

export function themeLabel(theme: ThemeId): string {
  return THEMES.find((entry) => entry.id === theme)?.label ?? theme;
}
