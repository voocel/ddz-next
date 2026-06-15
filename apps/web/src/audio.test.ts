import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIO_LEVELS, parseAudioLevels } from "./audio";

describe("parseAudioLevels（音量解析与夹值）", () => {
  it("空值返回默认（默认静音 0/0）", () => {
    expect(parseAudioLevels(null)).toEqual(DEFAULT_AUDIO_LEVELS);
    expect(parseAudioLevels("")).toEqual(DEFAULT_AUDIO_LEVELS);
  });

  it("正常值原样解析", () => {
    expect(parseAudioLevels(JSON.stringify({ music: 0.4, sfx: 0.6 }))).toEqual({ music: 0.4, sfx: 0.6 });
  });

  it("越界值夹到 0..1", () => {
    expect(parseAudioLevels(JSON.stringify({ music: 1.8, sfx: -3 }))).toEqual({ music: 1, sfx: 0 });
  });

  it("非法/缺省字段回退为 0", () => {
    expect(parseAudioLevels(JSON.stringify({ music: "x" }))).toEqual({ music: 0, sfx: 0 });
  });

  it("损坏 JSON 安全回退默认", () => {
    expect(parseAudioLevels("{not json")).toEqual(DEFAULT_AUDIO_LEVELS);
  });
});
