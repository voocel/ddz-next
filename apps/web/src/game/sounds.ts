import type { CardId, CombinationKind } from "@ddz/domain";

import type { ThemeId } from "../theme";

/**
 * 音效单一数据源：key → 文件名。新增音效只改这里，类型/预加载/映射自动跟随。
 * 文件位于 public/assets/audio/。
 */
export const SOUND_FILES = {
  "sound-select": "select.mp3",
  "sound-play": "play.mp3",
  "sound-pass": "pass0.mp3",
  "sound-deal": "deal.mp3",
  "sound-start": "start.mp3",
  "sound-win": "end_win.mp3",
  "sound-lose": "end_lose.mp3",
  // 叫/抢地主语音
  "sound-call": "call.mp3",
  "sound-nocall": "nocall0.mp3",
  "sound-rob": "rob0.mp3",
  "sound-norob": "norob.mp3",
  // 牌型语音
  "sound-bomb": "bomb0.mp3",
  "sound-rocket": "joker_bomb.mp3",
  "sound-plane": "plane.mp3",
  "sound-straight": "single_line.mp3",
  "sound-pair-seq": "double_line.mp3",
  "sound-trio-single": "three_take_one.mp3",
  "sound-trio-pair": "three_take_two.mp3",
  "sound-four-two": "four_take_two.mp3",
  "sound-big-joker": "big_joker.mp3",
  "sound-small-joker": "small_joker.mp3",
  // 回合超时提醒
  "sound-alarm": "alarm.mp3",
  // 房间背景音乐（按主题选曲，循环低音量）
  "sound-bgm-cartoon": "bg_room0.mp3",
  "sound-bgm-pixel": "bg_room1.mp3"
} as const satisfies Record<string, string>;

export type SoundKey = keyof typeof SOUND_FILES;

/** 背景音乐音量基准；仍低于音效，但在 Windows/Chrome 上不至于明显偏小。 */
export const BGM_VOLUME = 0.42;

/** 按主题选背景音乐：欢乐卡通与田园像素各用一首，强化主题氛围。 */
export function bgmKey(theme: ThemeId): SoundKey {
  return theme === "pixel" ? "sound-bgm-pixel" : "sound-bgm-cartoon";
}

/** 牌型 → 专属音效；普通单/对/三及未列出的牌型落到通用 sound-play */
const COMBINATION_SOUNDS: Partial<Record<CombinationKind, SoundKey>> = {
  bomb: "sound-bomb",
  rocket: "sound-rocket",
  plane: "sound-plane",
  plane_with_singles: "sound-plane",
  plane_with_pairs: "sound-plane",
  straight: "sound-straight",
  pair_sequence: "sound-pair-seq",
  trio_with_single: "sound-trio-single",
  trio_with_pair: "sound-trio-pair",
  four_with_two_singles: "sound-four-two",
  four_with_two_pairs: "sound-four-two"
};

/** 出牌音效解析：单张大/小王有专属语音，其余按牌型映射，普通牌落到通用出牌音。 */
export function cardsSoundKey(kind: CombinationKind, firstCardId: CardId | undefined): SoundKey {
  if (kind === "single") {
    if (firstCardId === "BJ") {
      return "sound-big-joker";
    }
    if (firstCardId === "SJ") {
      return "sound-small-joker";
    }
  }
  return COMBINATION_SOUNDS[kind] ?? "sound-play";
}
