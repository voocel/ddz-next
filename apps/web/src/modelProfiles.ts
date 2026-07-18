/**
 * 模型选手档案：model/provider → 拟人化头像、别名、标语、品牌色的单一事实源。
 * 排行榜、观战页、复盘页、牌桌思考面板共用；素材位于 public/assets/models/。
 * 模型清单由服务端动态下发，这里按名称关键字归组到厂牌档案，未识别的走神秘选手兜底。
 */
export interface ModelProfile {
  /** 选手别名（厂牌代号） */
  readonly alias: string;
  /** 拟人化选手头像 */
  readonly avatar: string;
  /** 选手标语（观战页/档案卡展示） */
  readonly tagline: string;
  /** 厂牌品牌色（思考面板描边/光环/徽章的 --ai-accent） */
  readonly accent: string;
}

const PROFILES: ReadonlyArray<{ readonly match: RegExp; readonly profile: ModelProfile }> = [
  {
    match: /claude|anthropic/i,
    profile: { alias: "Claude", avatar: "/assets/models/claude.png", tagline: "深思熟虑的牌桌哲学家", accent: "#d97757" }
  },
  {
    match: /gpt|openai|(^|\W)o\d/i,
    profile: { alias: "GPT", avatar: "/assets/models/gpt.png", tagline: "百科全书式的全能选手", accent: "#10a37f" }
  },
  {
    match: /gemini|google/i,
    profile: { alias: "Gemini", avatar: "/assets/models/gemini.png", tagline: "双子星的直觉派打法", accent: "#8ab4f8" }
  },
  {
    match: /deepseek/i,
    profile: { alias: "DeepSeek", avatar: "/assets/models/deepseek.png", tagline: "深潜牌局的推理猎手", accent: "#4d6bfe" }
  },
  {
    match: /qwen|tongyi/i,
    profile: { alias: "通义千问", avatar: "/assets/models/qwen.png", tagline: "千问千答的东方智将", accent: "#a855f7" }
  },
  {
    match: /kimi|moonshot/i,
    profile: { alias: "Kimi", avatar: "/assets/models/kimi.png", tagline: "月之暗面的冷静杀手", accent: "#38bdf8" }
  },
  {
    match: /grok|xai/i,
    profile: { alias: "Grok", avatar: "/assets/models/grok.png", tagline: "不按套路出牌的狂想家", accent: "#ef4444" }
  }
];

export const FALLBACK_PROFILE: ModelProfile = {
  alias: "神秘选手",
  avatar: "/assets/models/default.png",
  tagline: "来历不明的挑战者",
  accent: "#ffb300"
};

/** 依 model 名（优先）与 provider 名匹配选手档案 */
export function modelProfile(model: string, provider = ""): ModelProfile {
  return (
    PROFILES.find(({ match }) => match.test(model))?.profile ??
    PROFILES.find(({ match }) => match.test(provider))?.profile ??
    FALLBACK_PROFILE
  );
}
