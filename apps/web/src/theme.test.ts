import { describe, expect, it } from "vitest";

import { AVATAR_COUNT, avatarIndex, avatarIndexes } from "./theme";

describe("avatarIndexes（同桌头像去重）", () => {
  it("返回与输入等长、且同桌不重复", () => {
    const indexes = avatarIndexes(["alpha", "beta", "gamma"]);
    expect(indexes).toHaveLength(3);
    expect(new Set(indexes).size).toBe(3);
    expect(indexes.every((i) => i >= 1 && i <= AVATAR_COUNT)).toBe(true);
  });

  it("即使初始 hash 撞号也能去重：AVATAR_COUNT 个 seed 去重后恰为 1..N 的排列", () => {
    const seeds = Array.from({ length: AVATAR_COUNT }, (_, i) => `seed-${i}`);
    const indexes = avatarIndexes(seeds);
    expect(new Set(indexes).size).toBe(AVATAR_COUNT);
    expect([...indexes].sort((a, b) => a - b)).toEqual(
      Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1)
    );
  });

  it("首个序号与 avatarIndex 一致，且结果确定性稳定", () => {
    expect(avatarIndexes(["alice"])[0]).toBe(avatarIndex("alice"));
    expect(avatarIndexes(["a", "b", "c"])).toEqual(avatarIndexes(["a", "b", "c"]));
  });
});
