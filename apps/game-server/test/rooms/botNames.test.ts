import { describe, expect, it } from "vitest";
import { pickBotNicknames } from "../../src/rooms/botNames";

describe("pickBotNicknames", () => {
  it("returns the requested count of distinct names", () => {
    const names = pickBotNicknames(2);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("avoids names already taken in the room", () => {
    const taken = ["AI小七", "AI阿强"];
    const names = pickBotNicknames(2, taken);
    for (const name of names) {
      expect(taken).not.toContain(name);
    }
  });

  it("falls back to unique 机器人N when the pool cannot satisfy the count", () => {
    // 取超过池容量,触发兜底;兜底名也须互不相同
    const names = pickBotNicknames(20);
    expect(names).toHaveLength(20);
    expect(new Set(names).size).toBe(20);
    expect(names.some((name) => /^机器人\d+$/.test(name))).toBe(true);
  });
});
