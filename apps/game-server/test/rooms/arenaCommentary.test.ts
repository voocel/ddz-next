import { describe, expect, it, vi } from "vitest";
import type { ArenaCommentaryContext, BotProviderRegistry } from "@ddz/bot-ai";
import { ArenaCommentaryDirector, arenaCommentaryModelFromEnv } from "../../src/rooms/arenaCommentary";

const context: ArenaCommentaryContext = {
  seats: [],
  event: "测试事件",
  multiplier: 1,
  recentActions: []
};

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ArenaCommentaryDirector", () => {
  it("最小间隔内的普通触发被跳过(不排队)", async () => {
    let now = 0;
    const comment = vi.fn(async () => "解说词");
    const broadcast = vi.fn();
    const director = new ArenaCommentaryDirector({
      commentator: { comment },
      broadcast,
      minIntervalMs: 8000,
      now: () => now
    });

    director.notify("bomb", context);
    await flushMicrotasks();
    now = 3000;
    director.notify("landlord", context);
    await flushMicrotasks();

    expect(comment).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith("解说词", "bomb");

    now = 9000;
    director.notify("landlord", context);
    await flushMicrotasks();
    expect(comment).toHaveBeenCalledTimes(2);
  });

  it("opening/settlement 不受最小间隔节流", async () => {
    let now = 0;
    const comment = vi.fn(async () => "解说词");
    const broadcast = vi.fn();
    const director = new ArenaCommentaryDirector({ commentator: { comment }, broadcast, minIntervalMs: 8000, now: () => now });

    director.notify("bomb", context);
    await flushMicrotasks();
    now = 1000;
    director.notify("settlement", context);
    await flushMicrotasks();

    expect(comment).toHaveBeenCalledTimes(2);
  });

  it("同时最多 1 个 in-flight:生成期间的触发一律跳过", async () => {
    let resolveComment: (value: string | null) => void = () => {};
    const comment = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveComment = resolve;
        })
    );
    const broadcast = vi.fn();
    const director = new ArenaCommentaryDirector({ commentator: { comment }, broadcast, minIntervalMs: 0, now: () => 0 });

    director.notify("bomb", context);
    director.notify("settlement", context);
    expect(comment).toHaveBeenCalledTimes(1);

    resolveComment("迟到的解说");
    await flushMicrotasks();
    expect(broadcast).toHaveBeenCalledWith("迟到的解说", "bomb");
  });

  it("生成失败/返回 null 时静默不广播", async () => {
    const broadcast = vi.fn();
    const failing = new ArenaCommentaryDirector({
      commentator: { comment: vi.fn(async () => null) },
      broadcast,
      now: () => 0
    });
    failing.notify("bomb", context);
    await flushMicrotasks();

    const throwing = new ArenaCommentaryDirector({
      commentator: {
        comment: vi.fn(async () => {
          throw new Error("boom");
        })
      },
      broadcast,
      now: () => 0
    });
    throwing.notify("bomb", context);
    await flushMicrotasks();

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe("arenaCommentaryModelFromEnv", () => {
  const registry = { default: { provider: "anthropic", model: "claude-haiku" } } as BotProviderRegistry;

  it("缺省用注册表默认模型", () => {
    expect(arenaCommentaryModelFromEnv(registry, {})).toEqual({ provider: "anthropic", model: "claude-haiku" });
  });

  it("ARENA_COMMENTARY_MODEL 指定 provider/model", () => {
    expect(arenaCommentaryModelFromEnv(registry, { ARENA_COMMENTARY_MODEL: "openai/gpt-5-mini" })).toEqual({
      provider: "openai",
      model: "gpt-5-mini"
    });
  });

  it("ARENA_COMMENTARY_ENABLED=false 显式关闭", () => {
    expect(arenaCommentaryModelFromEnv(registry, { ARENA_COMMENTARY_ENABLED: "false" })).toBeNull();
  });

  it("非法格式直接抛错", () => {
    expect(() => arenaCommentaryModelFromEnv(registry, { ARENA_COMMENTARY_MODEL: "no-slash" })).toThrow(
      /provider\/model/
    );
  });
});
