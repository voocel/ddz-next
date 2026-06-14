import { describe, expect, it } from "vitest";

import { COMBINATION_KINDS, type CombinationKind } from "@ddz/domain";

import { cardsSoundKey, SOUND_FILES } from "./sounds";

describe("cardsSoundKey（出牌音效映射）", () => {
  it("各牌型映射到预期专属音效", () => {
    const cases: Array<[CombinationKind, string]> = [
      ["bomb", "sound-bomb"],
      ["rocket", "sound-rocket"],
      ["plane", "sound-plane"],
      ["plane_with_singles", "sound-plane"],
      ["plane_with_pairs", "sound-plane"],
      ["straight", "sound-straight"],
      ["pair_sequence", "sound-pair-seq"],
      ["trio_with_single", "sound-trio-single"],
      ["trio_with_pair", "sound-trio-pair"],
      ["four_with_two_singles", "sound-four-two"],
      ["four_with_two_pairs", "sound-four-two"]
    ];
    for (const [kind, key] of cases) {
      expect(cardsSoundKey(kind, undefined)).toBe(key);
    }
  });

  it("单张大/小王有专属语音，其余单张落到通用出牌音", () => {
    expect(cardsSoundKey("single", "BJ")).toBe("sound-big-joker");
    expect(cardsSoundKey("single", "SJ")).toBe("sound-small-joker");
    expect(cardsSoundKey("single", "3-hearts")).toBe("sound-play");
    expect(cardsSoundKey("single", undefined)).toBe("sound-play");
  });

  it("普通单/对/三落到通用出牌音", () => {
    expect(cardsSoundKey("pair", undefined)).toBe("sound-play");
    expect(cardsSoundKey("trio", undefined)).toBe("sound-play");
  });

  it("所有牌型的映射结果都是已注册的音效 key（防止漏配资源）", () => {
    for (const kind of COMBINATION_KINDS) {
      expect(SOUND_FILES).toHaveProperty(cardsSoundKey(kind, undefined));
    }
  });
});
