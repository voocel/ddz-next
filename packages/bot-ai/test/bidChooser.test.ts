import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import type { BiddingContext } from "../src";
import { buildBiddingSystem, formatBiddingPrompt, LlmBidChooser } from "../src";

// streamText 桩(vi.hoisted 保证在 mock 工厂执行前已初始化)。
const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));
vi.mock("ai", () => ({ streamText: (options: unknown) => streamTextMock(options) }));

const fakeModel = { modelId: "test-model" } as unknown as LanguageModel;

beforeEach(() => {
  streamTextMock.mockReset();
});

function biddingContext(overrides: Partial<BiddingContext> = {}): BiddingContext {
  return {
    kind: "bidding",
    hand: ["3×2", "7", "K×2", "大王"],
    bidHistory: [{ by: "上家", action: "bid", description: "不叫" }],
    currentMultiplier: 1,
    isCounterRob: false,
    candidates: ["不叫", "叫地主"],
    ...overrides
  };
}

/** 最小 streamText 返回值:空流 + 各最终值 resolved,足够 runner 收尾。 */
function fakeResult(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: "text-delta", text };
    })(),
    text: Promise.resolve(text),
    reasoningText: Promise.resolve(undefined),
    finishReason: Promise.resolve("stop"),
    usage: Promise.resolve({ inputTokens: 100, outputTokens: 2 }),
    request: Promise.resolve({})
  };
}

describe("formatBiddingPrompt", () => {
  it("叫地主 prompt 含手牌/倍数/叫抢过程与编号候选", () => {
    const text = formatBiddingPrompt(biddingContext());

    expect(text).toContain("你的手牌:3×2 7 K×2 大王");
    expect(text).toContain("当前倍数:1");
    expect(text).toContain("上家: 不叫");
    expect(text).toContain("轮到你叫地主");
    expect(text).toContain("1: 不叫");
    expect(text).toContain("2: 叫地主");
    expect(text).toContain("1 到 2");
  });

  it("普通抢地主 prompt 说明抢则倍数 ×2", () => {
    const text = formatBiddingPrompt(
      biddingContext({ kind: "robbing", currentMultiplier: 2, candidates: ["不抢", "抢地主"] })
    );

    expect(text).toContain("轮到你抢地主");
    expect(text).toContain("当前倍数:2");
    expect(text).toContain("1: 不抢");
    expect(text).toContain("2: 抢地主");
  });

  it("首叫者反抢 prompt 说明唯一一次反抢语义", () => {
    const text = formatBiddingPrompt(
      biddingContext({ kind: "robbing", isCounterRob: true, currentMultiplier: 2, candidates: ["不抢", "抢地主"] })
    );

    expect(text).toContain("反抢");
    expect(text).toContain("唯一一次");
  });
});

describe("buildBiddingSystem", () => {
  it("讲清叫抢博弈结构并强约束只输出编号数字", () => {
    const system = buildBiddingSystem();

    expect(system).toContain("叫地主/抢地主");
    expect(system).toContain("底牌");
    expect(system).toContain("倍数 ×2");
    expect(system).toContain("编号数字");
    expect(system).toContain("简体中文");
  });
});

describe("LlmBidChooser", () => {
  it("组装叫抢 system/prompt 交给共享管线,并解析编号为 0 基索引", async () => {
    streamTextMock.mockReturnValueOnce(fakeResult("2"));
    const chooser = new LlmBidChooser({ model: fakeModel });

    const decision = await chooser.choose(biddingContext());

    expect(decision?.index).toBe(1);
    expect(decision?.trace.error).toBeNull();
    const request = streamTextMock.mock.calls[0]![0] as { system: string; prompt: string };
    expect(request.system).toBe(buildBiddingSystem());
    expect(request.prompt).toBe(formatBiddingPrompt(biddingContext()));
  });

  it("model 为 null(缺 key)时不发请求,返回 null 由上层抛错暴露", async () => {
    const chooser = new LlmBidChooser({ model: null });

    expect(await chooser.choose(biddingContext())).toBeNull();
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
