import { describe, expect, it } from "vitest";
import type { MoveSelectionContext } from "../src";
import { LlmMoveChooser, parseMoveIndex } from "../src";

describe("parseMoveIndex", () => {
  it("接受 [0, count) 内的整数", () => {
    expect(parseMoveIndex(0, 3)).toBe(0);
    expect(parseMoveIndex(2, 3)).toBe(2);
  });

  it("接受纯数字字符串(模型按要求只回数字)", () => {
    expect(parseMoveIndex("1", 3)).toBe(1);
    expect(parseMoveIndex("  2 ", 3)).toBe(2);
    expect(parseMoveIndex("0", 3)).toBe(0);
  });

  it("夹带解释时取首个落在范围内的整数(prompt 已要求只回数字,这是兜底)", () => {
    expect(parseMoveIndex("我选 2 号", 3)).toBe(2);
    expect(parseMoveIndex("编号:1", 3)).toBe(1);
    // 第一个数字越界时跳过,取下一个落在范围内的
    expect(parseMoveIndex("99 太大,选 1", 3)).toBe(1);
  });

  it("越界/负数/非整数/解析不出数字返回 null", () => {
    expect(parseMoveIndex(3, 3)).toBeNull();
    expect(parseMoveIndex(-1, 3)).toBeNull();
    expect(parseMoveIndex(1.5, 3)).toBeNull();
    expect(parseMoveIndex("9", 3)).toBeNull();
    expect(parseMoveIndex("过牌", 3)).toBeNull();
    expect(parseMoveIndex("", 3)).toBeNull();
    expect(parseMoveIndex(undefined, 3)).toBeNull();
    expect(parseMoveIndex(Number.NaN, 3)).toBeNull();
  });
});

describe("LlmMoveChooser", () => {
  const context: MoveSelectionContext = {
    role: "landlord",
    hand: ["3", "5×2", "K×2", "2"],
    playedCards: ["4×2", "9", "J×3", "小王"],
    opponents: [
      { label: "农民", handCount: 8 },
      { label: "农民", handCount: 9 }
    ],
    lastPlay: { by: "农民", description: "对子K" },
    candidates: ["过牌(不出)", "对子 2", "炸弹 33334"]
  };

  it("无候选时直接返回 null,不发起请求", async () => {
    const chooser = new LlmMoveChooser({ model: null });
    await expect(chooser.choose({ ...context, candidates: [] })).resolves.toBeNull();
  });

  it("model 为 null(缺密钥/未配置)时静默返回 null,不发起请求", async () => {
    const chooser = new LlmMoveChooser({ model: null });
    await expect(chooser.choose(context)).resolves.toBeNull();
  });
});
