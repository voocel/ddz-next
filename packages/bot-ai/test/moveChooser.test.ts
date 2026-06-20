import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import type { MoveSelectionContext } from "../src";
import { LlmMoveChooser, parseMoveIndex } from "../src";

// streamText 桩(vi.hoisted 保证在 mock 工厂执行前已初始化)。
const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));
vi.mock("ai", () => ({ streamText: (options: unknown) => streamTextMock(options) }));

// 选牌只取 model.modelId,并把 model 交给(已 mock 的)streamText,故最小桩即可。
const fakeModel = { modelId: "test-model" } as unknown as LanguageModel;

const context: MoveSelectionContext = {
  role: "landlord",
  hand: ["3", "5×2", "K×2", "2"],
  playedCards: ["4×2", "9", "J×3", "小王"],
  opponents: [
    { label: "农民", handCount: 8, revealedCards: [] },
    { label: "农民", handCount: 9, revealedCards: ["7×2", "K"] }
  ],
  lastPlay: { by: "农民", description: "对子K" },
  candidates: ["过牌(不出)", "对子 2", "炸弹 33334"]
};

/** 造一个 streamText 返回值:fullStream 逐个吐 parts,各最终值用 resolved Promise。 */
function fakeResult(opts: {
  parts: ReadonlyArray<{ type: string; text?: string; error?: unknown }>;
  text?: string;
  reasoningText?: string | undefined;
  requestBody?: unknown;
}) {
  return {
    fullStream: (async function* () {
      for (const part of opts.parts) {
        yield part;
      }
    })(),
    text: Promise.resolve(opts.text ?? "0"),
    reasoningText: Promise.resolve(opts.reasoningText),
    finishReason: Promise.resolve("stop"),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
    request: Promise.resolve({ body: opts.requestBody })
  };
}

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
  beforeEach(() => streamTextMock.mockReset());

  it("无候选时直接返回 null,不发起请求", async () => {
    const chooser = new LlmMoveChooser({ model: null });
    await expect(chooser.choose({ ...context, candidates: [] })).resolves.toBeNull();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("model 为 null(缺密钥/未配置)时静默返回 null,不发起请求", async () => {
    const chooser = new LlmMoveChooser({ model: null });
    await expect(chooser.choose(context)).resolves.toBeNull();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("流式回调 reasoning 与普通文本增量,按最终文本解析编号并留证 reasoningText", async () => {
    streamTextMock.mockReturnValue(
      fakeResult({
        parts: [
          { type: "reasoning-start" },
          { type: "reasoning-delta", text: "对手剩两张," },
          { type: "reasoning-delta", text: "我压一手" },
          { type: "reasoning-end" },
          { type: "text-delta", text: "1" }
        ],
        text: "1",
        reasoningText: "对手剩两张,我压一手"
      })
    );
    const deltas: Array<{ channel: "reasoning" | "text"; text: string }> = [];
    const chooser = new LlmMoveChooser({ model: fakeModel });
    const decision = await chooser.choose(context, { onDelta: (delta) => deltas.push(delta) });
    expect(deltas).toEqual([
      { channel: "reasoning", text: "对手剩两张," },
      { channel: "reasoning", text: "我压一手" },
      { channel: "text", text: "1" }
    ]);
    expect(decision?.index).toBe(1);
    expect(decision?.trace.reasoningText).toBe("对手剩两张,我压一手");
    expect(decision?.trace.error).toBeNull();
  });

  it("不传 streamHooks 也正常返回(行为等价)", async () => {
    streamTextMock.mockReturnValue(
      fakeResult({ parts: [{ type: "reasoning-delta", text: "略" }], text: "2" })
    );
    const chooser = new LlmMoveChooser({ model: fakeModel });
    const decision = await chooser.choose(context);
    expect(decision?.index).toBe(2);
    expect(decision?.trace.error).toBeNull();
  });

  it("把 providerOptions 透传给 streamText,供 DeepSeek thinking/reasoning_effort 进请求体", async () => {
    const providerOptions = { deepseek: { thinking: { type: "disabled" } } };
    streamTextMock.mockReturnValue(
      fakeResult({
        parts: [{ type: "text-delta", text: "1" }],
        text: "1",
        requestBody: { thinking: { type: "disabled" } }
      })
    );
    const chooser = new LlmMoveChooser({ model: fakeModel, providerOptions });

    const decision = await chooser.choose(context);

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ providerOptions }));
    expect(decision?.trace.requestSummary).toEqual({
      providerOptions,
      deepseekControls: { thinking: { type: "disabled" } },
      finalBodyControls: { thinking: { type: "disabled" } }
    });
  });

  it("prompt 结构化展示对手剩牌与公开明牌", async () => {
    streamTextMock.mockReturnValue(fakeResult({ parts: [{ type: "text-delta", text: "1" }], text: "1" }));
    const chooser = new LlmMoveChooser({ model: fakeModel });

    await chooser.choose(context);

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("其他两家:农民剩 8 张,农民剩 9 张,明牌:7×2 K。")
      })
    );
  });

  it("流中出现 error part → 抛错捕获进 trace.error(不静默降级),index 为 null", async () => {
    streamTextMock.mockReturnValue(
      fakeResult({
        parts: [
          { type: "reasoning-delta", text: "想" },
          { type: "error", error: new Error("上游 500") }
        ],
        text: "1"
      })
    );
    const deltas: Array<{ channel: "reasoning" | "text"; text: string }> = [];
    const chooser = new LlmMoveChooser({ model: fakeModel });
    const decision = await chooser.choose(context, { onDelta: (delta) => deltas.push(delta) });
    expect(deltas).toEqual([{ channel: "reasoning", text: "想" }]);
    expect(decision?.index).toBeNull();
    expect(decision?.trace.error).toContain("上游 500");
  });
});
