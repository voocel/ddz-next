import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { LlmChoiceRunner } from "../src";

// streamText 桩(vi.hoisted 保证在 mock 工厂执行前已初始化)。
const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));
vi.mock("ai", () => ({ streamText: (options: unknown) => streamTextMock(options) }));

const fakeModel = { modelId: "test-model" } as unknown as LanguageModel;
const request = { system: "system", prompt: "prompt", candidateCount: 3 };

/** 可被 abort 打断的延时(Infinity 悬挂不排定时器):模拟真实 SDK「abort 后流以异常终止」的行为。 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = Number.isFinite(ms) ? setTimeout(resolve, ms) : null;
    signal.addEventListener(
      "abort",
      () => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        reject(new Error("aborted"));
      },
      { once: true }
    );
  });
}

interface StreamPlan {
  /** 每个增量前的等待毫秒数;Infinity 表示悬挂(只能被 abort 打断)。 */
  readonly gaps: readonly number[];
  readonly finalText?: string;
}

function stubStream(plan: StreamPlan): void {
  streamTextMock.mockImplementation((options: { abortSignal: AbortSignal }) => {
    const signal = options.abortSignal;
    return {
      fullStream: (async function* () {
        for (const gap of plan.gaps) {
          await delay(gap, signal);
          yield { type: "reasoning-delta", text: "思考片段" };
        }
        if (plan.finalText !== undefined) {
          yield { type: "text-delta", text: plan.finalText };
        }
      })(),
      text: Promise.resolve(plan.finalText ?? ""),
      reasoningText: Promise.resolve(undefined),
      finishReason: Promise.resolve("stop"),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
      request: Promise.resolve({ body: undefined })
    };
  });
}

describe("LlmChoiceRunner 输出 token 上限(按 provider 类型)", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deepseek 官方源 65536(thinking 思维链可烧穿 8192 的实测事故),其余 16384,显式传参优先", async () => {
    stubStream({ gaps: [], finalText: "1" });
    const cases = [
      { provider: { key: "deepseek", type: "deepseek" }, expected: 65_536 },
      { provider: { key: "wool", type: "openai" }, expected: 16_384 },
      { provider: undefined, expected: 16_384 },
      { provider: { key: "deepseek", type: "deepseek" }, maxOutputTokens: 4096, expected: 4096 }
    ] as const;
    for (const { provider, maxOutputTokens, expected } of cases) {
      streamTextMock.mockClear();
      const runner = new LlmChoiceRunner({
        model: fakeModel,
        timeoutMs: 1000,
        ...(provider ? { provider } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {})
      });
      const pending = runner.run(request);
      await vi.advanceTimersByTimeAsync(10);
      await pending;
      expect(streamTextMock.mock.calls[0]?.[0]?.maxOutputTokens).toBe(expected);
    }
  });
});

describe("LlmChoiceRunner 超时(流静默口径)", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("持续吐增量的长思考不会被误杀:总时长超过 timeoutMs 但静默间隔未超", async () => {
    // 4 段思考各间隔 800ms,总 3200ms > timeoutMs 1000(旧总时长口径会在 1000ms 处误杀)
    stubStream({ gaps: [800, 800, 800, 800], finalText: "2" });
    const runner = new LlmChoiceRunner({ model: fakeModel, timeoutMs: 1000 });

    const pending = runner.run(request);
    await vi.advanceTimersByTimeAsync(3300);
    const decision = await pending;

    expect(decision?.trace.error).toBeNull();
    expect(decision?.index).toBe(1);
  });

  it("流静默超过 timeoutMs 即中止,并给出明确超时消息(而非 SDK 的含混错误)", async () => {
    stubStream({ gaps: [100, Number.POSITIVE_INFINITY] });
    const runner = new LlmChoiceRunner({ model: fakeModel, timeoutMs: 1000 });

    const pending = runner.run(request);
    await vi.advanceTimersByTimeAsync(1200);
    const decision = await pending;

    expect(decision?.index).toBeNull();
    expect(decision?.trace.error).toBe("LLM 流静默超过 1000ms,已中止请求");
  });

  it("总时长硬上限(timeoutMs × 5):增量不断但拖满上限时仍中止", async () => {
    // 每 900ms 一个增量,静默计时永不触发;5000ms 总上限兜底
    stubStream({ gaps: Array.from({ length: 20 }, () => 900) });
    const runner = new LlmChoiceRunner({ model: fakeModel, timeoutMs: 1000 });

    const pending = runner.run(request);
    await vi.advanceTimersByTimeAsync(5100);
    const decision = await pending;

    expect(decision?.index).toBeNull();
    expect(decision?.trace.error).toBe("LLM 请求总时长超过 5000ms,已中止请求");
  });
});
