import { describe, expect, it, vi } from "vitest";
import type { Card, CardId, Combination, GamePhase, GameSnapshot, PlayerId } from "@ddz/domain";
import { identifyCombination, parseCardIds } from "@ddz/domain";
import type { ChooserTrace, MoveChooser, MoveDecision, MoveSelectionContext } from "@ddz/bot-ai";
import type { BotAction, BotBrain } from "../../src/rooms/botBrain";
import {
  LlmBotBrain,
  LlmDecisionError,
  type LlmDecisionMetric,
  type LlmDecisionTrace
} from "../../src/rooms/llmBotBrain";

function combo(ids: readonly CardId[]): Combination {
  const result = identifyCombination(parseCardIds([...ids]));
  if (!result) {
    throw new Error(`Invalid combination for test: ${ids.join(",")}`);
  }
  return result;
}

// 仅 phase / lastPlay / landlordId / players(handCount) 参与决策,其余给最小合法占位。
function snapshot(options: {
  phase: GamePhase;
  lastPlay?: Combination | null;
  landlordId?: PlayerId | null;
  handCounts?: Record<PlayerId, number>;
}): GameSnapshot {
  const handCounts = options.handCounts ?? { p0: 5, p1: 8, p2: 9 };
  return {
    phase: options.phase,
    players: (["p0", "p1", "p2"] as const).map((id, seat) => ({
      id,
      kind: "bot",
      seat: seat as 0 | 1 | 2,
      ready: true,
      handCount: handCounts[id] ?? 0,
      connected: true,
      score: 0
    })),
    currentPlayerId: "p0",
    landlordId: options.landlordId ?? null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: options.lastPlay ? { playerId: "p1", cards: [], combination: options.lastPlay } : null,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}

function hand(ids: readonly CardId[]): readonly Card[] {
  return parseCardIds([...ids]);
}

function traceFixture(overrides: Partial<ChooserTrace> = {}): ChooserTrace {
  return {
    modelId: "test-model",
    system: "sys",
    prompt: "prompt",
    rawText: "1",
    reasoningText: null,
    finishReason: "stop",
    usage: null,
    error: null,
    errorStack: null,
    ...overrides
  };
}

function chooserReturning(result: MoveDecision | null, onCall?: (ctx: MoveSelectionContext) => void): MoveChooser {
  return {
    choose: (ctx) => {
      onCall?.(ctx);
      return Promise.resolve(result);
    }
  };
}

function recordingBidStrategy(action: BotAction): BotBrain & { calls: number } {
  return {
    calls: 0,
    decide(this: { calls: number }) {
      this.calls += 1;
      return Promise.resolve(action);
    }
  };
}

const PASS: BotAction = { type: "pass" };

describe("LlmBotBrain", () => {
  it("叫/抢地主相位走固定策略(隔离实验变量,不调用 LLM)", async () => {
    const bidStrategy = recordingBidStrategy({ type: "bid_landlord", called: true });
    const chooser = chooserReturning(null, () => {
      throw new Error("chooser should not be called outside playing phase");
    });
    const brain = new LlmBotBrain({ chooser, bidStrategy });

    const action = await brain.decide(snapshot({ phase: "bidding" }), "p0", hand(["3-clubs"]), []);
    expect(action).toEqual({ type: "bid_landlord", called: true });
    expect(bidStrategy.calls).toBe(1);
  });

  it("跟牌且压不动时直接过牌,不调用 LLM", async () => {
    const chooser = chooserReturning(null, () => {
      throw new Error("chooser should not be called when only pass is legal");
    });
    const brain = new LlmBotBrain({ chooser });

    const action = await brain.decide(
      snapshot({ phase: "playing", lastPlay: combo(["K-clubs", "K-hearts"]), landlordId: "p1" }),
      "p0",
      hand(["3-clubs", "3-hearts"]),
      []
    );
    expect(action).toEqual(PASS);
  });

  it("领出且只剩唯一一手(最后一张牌)时直接出,不调用 LLM、不上报指标", async () => {
    const metrics: LlmDecisionMetric[] = [];
    const chooser = chooserReturning(null, () => {
      throw new Error("chooser should not be called when the only legal move is forced");
    });
    const brain = new LlmBotBrain({ chooser, onDecision: (m) => metrics.push(m) });

    const action = await brain.decide(
      snapshot({ phase: "playing", landlordId: "p0" }),
      "p0",
      hand(["7-spades"]),
      []
    );
    expect(action).toEqual({ type: "play_cards", cards: ["7-spades"] });
    expect(metrics).toEqual([]);
  });

  it("领出时按模型选择映射回具体出牌,并上报 llm 指标与延迟", async () => {
    let captured: MoveSelectionContext | null = null;
    const chooser = chooserReturning(
      { index: 1, trace: traceFixture({ usage: { inputTokens: 120, outputTokens: 8 } }) },
      (ctx) => {
        captured = ctx;
      }
    );
    const metrics: LlmDecisionMetric[] = [];
    const clock = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const brain = new LlmBotBrain({ chooser, onDecision: (m) => metrics.push(m), now: clock });

    const action = await brain.decide(snapshot({ phase: "playing", landlordId: "p0" }), "p0", hand(["3-clubs", "4-clubs"]), []);

    expect(action).toEqual({ type: "play_cards", cards: ["4-clubs"] });
    expect(captured!.role).toBe("landlord");
    expect(captured!.lastPlay).toBeNull();
    expect(captured!.candidates).toEqual(["单张3", "单张4"]);
    expect(metrics).toEqual([{ latencyMs: 42, usage: { inputTokens: 120, outputTokens: 8 } }]);
  });

  it("跟牌时编号 0 表示过牌", async () => {
    const chooser = chooserReturning({ index: 0, trace: traceFixture() });
    const brain = new LlmBotBrain({ chooser });

    const action = await brain.decide(
      snapshot({ phase: "playing", lastPlay: combo(["5-clubs", "5-hearts"]), landlordId: "p1" }),
      "p0",
      hand(["6-clubs", "6-hearts"]),
      []
    );
    expect(action).toEqual(PASS);
  });

  it("跟牌时非零编号映射到压制走法", async () => {
    let captured: MoveSelectionContext | null = null;
    const chooser = chooserReturning({ index: 1, trace: traceFixture() }, (ctx) => {
      captured = ctx;
    });
    const brain = new LlmBotBrain({ chooser });

    const action = await brain.decide(
      snapshot({ phase: "playing", lastPlay: combo(["5-clubs", "5-hearts"]), landlordId: "p1" }),
      "p0",
      hand(["6-clubs", "6-hearts"]),
      []
    );
    expect(action).toEqual({ type: "play_cards", cards: ["6-clubs", "6-hearts"] });
    expect(captured!.candidates).toEqual(["过牌(不出)", "对子6"]);
    // 上一手由 p1(本局地主)打出,自己是农民 → 标注「地主打出」,不再用会误导的「上家」
    expect(captured!.lastPlay).toEqual({ by: "地主", description: "对子5" });
  });

  it("农民视角:对手按身份标注(地主/队友),并下发完整手牌(分组计数)", async () => {
    let captured: MoveSelectionContext | null = null;
    const chooser = chooserReturning({ index: 1, trace: traceFixture() }, (ctx) => {
      captured = ctx;
    });
    const brain = new LlmBotBrain({ chooser });

    await brain.decide(
      snapshot({ phase: "playing", landlordId: "p1", handCounts: { p0: 3, p1: 8, p2: 9 } }),
      "p0",
      hand(["3-clubs", "3-hearts", "5-clubs"]),
      []
    );

    expect(captured!.role).toBe("farmer");
    // p1 是地主、p2 是另一农民(队友);按座位顺序给出,带身份标签
    expect(captured!.opponents).toEqual([
      { label: "地主", handCount: 8 },
      { label: "队友", handCount: 9 }
    ]);
    // 完整手牌按从小到大分组计数下发,供模型规划
    expect(captured!.hand).toEqual(["3×2", "5"]);
  });

  it("把本局已出的牌(公开信息)按分组计数喂给模型,并写入留证", async () => {
    let captured: MoveSelectionContext | null = null;
    const traces: LlmDecisionTrace[] = [];
    const chooser = chooserReturning({ index: 1, trace: traceFixture() }, (ctx) => {
      captured = ctx;
    });
    const brain = new LlmBotBrain({ chooser, onTrace: (t) => traces.push(t) });

    await brain.decide(
      snapshot({ phase: "playing", landlordId: "p0" }),
      "p0",
      hand(["3-clubs", "4-clubs"]),
      hand(["5-clubs", "5-hearts", "9-spades", "BJ"])
    );

    // 出过的牌是桌面公开信息,按从小到大分组计数下发(与手牌同口径),并原样进 trace 供离线分析
    expect(captured!.playedCards).toEqual(["5×2", "9", "大王"]);
    expect(traces[0]!.playedCards).toEqual(["5×2", "9", "大王"]);
  });

  it("模型返回 null(超时/缺 key)时抛错暴露,不回退、不上报指标", async () => {
    const bidStrategy = recordingBidStrategy({ type: "play_cards", cards: ["3-clubs"] });
    const chooser = chooserReturning(null);
    const metrics: LlmDecisionMetric[] = [];
    const brain = new LlmBotBrain({ chooser, bidStrategy, onDecision: (m) => metrics.push(m) });

    await expect(
      brain.decide(snapshot({ phase: "playing", landlordId: "p0" }), "p0", hand(["3-clubs", "4-clubs"]), [])
    ).rejects.toBeInstanceOf(LlmDecisionError);
    // 出牌相位失败绝不回退叫抢策略,也不上报成功指标
    expect(bidStrategy.calls).toBe(0);
    expect(metrics).toEqual([]);
  });

  it("chooser 抛出真实错误(API/网络/超时)时原样冒泡,不吞、不回退", async () => {
    const boom = new Error("AI_APICallError: 401 invalid x-api-key");
    const chooser: MoveChooser = { choose: () => Promise.reject(boom) };
    const bidStrategy = recordingBidStrategy({ type: "play_cards", cards: ["3-clubs"] });
    const brain = new LlmBotBrain({ chooser, bidStrategy });

    await expect(
      brain.decide(snapshot({ phase: "playing", landlordId: "p0" }), "p0", hand(["3-clubs", "4-clubs"]), [])
    ).rejects.toThrow("401 invalid x-api-key");
    expect(bidStrategy.calls).toBe(0);
  });

  it("模型返回越界 index 时抛 invalid_index 错误暴露", async () => {
    const chooser = chooserReturning({ index: 9, trace: traceFixture() });
    const brain = new LlmBotBrain({ chooser });

    await expect(
      brain.decide(snapshot({ phase: "playing", landlordId: "p0" }), "p0", hand(["3-clubs", "4-clubs"]), [])
    ).rejects.toMatchObject({ reason: "invalid_index" });
  });

  it("成功决策时 onTrace 收到完整留证(手牌/system/prompt/思考/原始输出/用量/结局 ok)", async () => {
    const traces: LlmDecisionTrace[] = [];
    const chooser = chooserReturning({
      index: 1,
      trace: traceFixture({
        modelId: "gpt-5.5",
        system: "你是斗地主高手",
        prompt: "可选出牌...",
        rawText: "1",
        reasoningText: "对手只剩2张,我先出小的试探",
        usage: { inputTokens: 200, outputTokens: 12 }
      })
    });
    const brain = new LlmBotBrain({ chooser, onTrace: (t) => traces.push(t) });

    const action = await brain.decide(
      snapshot({ phase: "playing", landlordId: "p0" }),
      "p0",
      hand(["3-clubs", "4-clubs"]),
      []
    );

    expect(action).toEqual({ type: "play_cards", cards: ["4-clubs"] });
    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(trace.selfHand).toEqual(["3-clubs", "4-clubs"]);
    expect(trace.role).toBe("landlord");
    expect(trace.playedCards).toEqual([]);
    expect(trace.candidates).toEqual(["单张3", "单张4"]);
    expect(trace.modelId).toBe("gpt-5.5");
    expect(trace.reasoningText).toBe("对手只剩2张,我先出小的试探");
    expect(trace.usage).toEqual({ inputTokens: 200, outputTokens: 12 });
    expect(trace.outcome).toEqual({ kind: "ok", index: 1, action: { type: "play_cards", cards: ["4-clubs"] } });
  });

  it("请求出错(abort/API)时 onTrace 记 error 留证并抛 request_error,system/prompt 俱全", async () => {
    const traces: LlmDecisionTrace[] = [];
    const chooser = chooserReturning({
      index: null,
      trace: traceFixture({
        system: "你是斗地主高手",
        prompt: "可选出牌...",
        rawText: null,
        finishReason: null,
        error: "This operation was aborted",
        errorStack: "AbortError: ..."
      })
    });
    const brain = new LlmBotBrain({ chooser, onTrace: (t) => traces.push(t) });

    await expect(
      brain.decide(snapshot({ phase: "playing", landlordId: "p0" }), "p0", hand(["3-clubs", "4-clubs"]), [])
    ).rejects.toMatchObject({ reason: "request_error" });
    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(trace.outcome).toEqual({ kind: "error", message: "This operation was aborted" });
    expect(trace.system).toBe("你是斗地主高手");
    expect(trace.prompt).toBe("可选出牌...");
  });
});
