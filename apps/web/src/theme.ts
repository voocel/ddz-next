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

/** 每套主题的默认头像数量（见 scripts/gen_avatars.py） */
export const AVATAR_COUNT = 12;

/** 把稳定标识（用户/玩家 id）确定性映射到 1..AVATAR_COUNT 的默认头像序号 */
export function avatarIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % AVATAR_COUNT) + 1;
}

/** 为同桌多名玩家分配不重复头像：撞号则按 1..AVATAR_COUNT 环形探测下一个空位（按传入顺序稳定确定） */
export function avatarIndexes(seeds: string[]): number[] {
  const used = new Set<number>();
  return seeds.map((seed) => {
    let index = avatarIndex(seed);
    while (used.has(index) && used.size < AVATAR_COUNT) {
      index = (index % AVATAR_COUNT) + 1;
    }
    used.add(index);
    return index;
  });
}

/** 按主题取某标识对应的默认头像资源路径 */
export function avatarAsset(theme: ThemeId, seed: string): string {
  return themeAsset(theme, `avatar/${avatarIndex(seed)}.png`);
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
