import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { toSnapshotDto } from "../../src/dto";
import type { BotAction, BotBrain } from "../../src/rooms/botBrain";
import { BotTurnController } from "../../src/rooms/botTurnController";
import { LlmDecisionError } from "../../src/rooms/llmBotBrain";
import { SerialTaskQueue } from "../../src/rooms/serialTaskQueue";
import { playingTable } from "./tableFixtures";

function createController(
  overrides: {
    onRetriesExhausted?: ((playerId: string, message: string) => void) | null;
    retryMaxAttempts?: number;
  } = {}
) {
  const table = playingTable();
  const botId = table.snapshot().currentPlayerId!;
  const decide = vi.fn();
  const tasks = new SerialTaskQueue();
  const clock = { setTimeout: vi.fn(() => ({ clear: vi.fn() })) };
  const broadcast = vi.fn();
  const scheduleTurnTimer = vi.fn();
  const onApplyAction = vi.fn(async () => {});
  const onFailure = vi.fn(async () => {});
  const onDecisionSettled = vi.fn();
  const onRetriesExhausted = overrides.onRetriesExhausted ?? null;

  const controller = new BotTurnController({
    roomCode: "100031",
    table,
    brainFor: () => ({ decide } satisfies BotBrain),
    retryMaxAttempts: overrides.retryMaxAttempts ?? 3,
    clock,
    enqueue: (task) => tasks.enqueue(task),
    isFailed: () => false,
    broadcast,
    toSnapshotDto: (snapshot) => toSnapshotDto(snapshot, new Map(), new Map()),
    scheduleTurnTimer,
    onApplyAction,
    onRetriesExhausted,
    onFailure,
    onDecisionSettled
  });

  return { controller, table, botId, decide, clock, broadcast, scheduleTurnTimer, onApplyAction, onFailure, onDecisionSettled };
}

/** 触发第 index 个已安排的退避定时回调。 */
function fireBackoff(clock: { setTimeout: ReturnType<typeof vi.fn> }, index: number): void {
  (clock.setTimeout.mock.calls[index]![0] as () => void)();
}

describe("BotTurnController", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("首次失败:广播 attempt/willRetry 并安排 2s 退避;手动重试后成功落子", async () => {
    const fixture = createController();
    fixture.decide
      .mockRejectedValueOnce(new LlmDecisionError("request_error", "LLM 请求失败: 上游限流", 128))
      .mockResolvedValueOnce({ type: "pass" } satisfies BotAction);

    await fixture.controller.handleTurn(fixture.botId, () => true);

    expect(fixture.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bot_decision_failed",
        playerId: fixture.botId,
        message: "LLM 请求失败: 上游限流",
        retryable: true,
        attempt: 1,
        willRetry: true
      })
    );
    expect(fixture.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(fixture.onDecisionSettled).toHaveBeenCalledWith(fixture.botId);

    fixture.controller.retryManually();
    await vi.waitFor(() => {
      expect(fixture.decide).toHaveBeenCalledTimes(2);
      expect(fixture.onApplyAction).toHaveBeenCalledWith(fixture.botId, { type: "pass" });
    });
    // 重启路径把回合倒计时重置为满额
    expect(fixture.scheduleTurnTimer).toHaveBeenCalledTimes(1);
    expect(fixture.onFailure).not.toHaveBeenCalled();
  });

  it("退避回调自动重试:第二次决策成功落子", async () => {
    const fixture = createController();
    fixture.decide
      .mockRejectedValueOnce(new LlmDecisionError("request_error", "上游超时", 100))
      .mockResolvedValueOnce({ type: "pass" } satisfies BotAction);

    await fixture.controller.handleTurn(fixture.botId, () => true);
    fireBackoff(fixture.clock, 0);

    await vi.waitFor(() => {
      expect(fixture.onApplyAction).toHaveBeenCalledWith(fixture.botId, { type: "pass" });
    });
  });

  it("重试耗尽(真人房 null 出口):willRetry=false 等待手动,退避按 2s→4s 递增", async () => {
    const fixture = createController();
    fixture.decide.mockRejectedValue(new LlmDecisionError("request_error", "上游宕机", 100));

    await fixture.controller.handleTurn(fixture.botId, () => true);
    fireBackoff(fixture.clock, 0);
    await vi.waitFor(() => {
      expect(fixture.broadcast).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, willRetry: true }));
    });
    fireBackoff(fixture.clock, 1);
    await vi.waitFor(() => {
      expect(fixture.broadcast).toHaveBeenCalledWith(expect.objectContaining({ attempt: 3, willRetry: false }));
    });

    // 指数退避序列 + 第三次不再安排退避
    expect(fixture.clock.setTimeout.mock.calls.map((call) => call[1])).toEqual([2000, 4000]);
    expect(fixture.onApplyAction).not.toHaveBeenCalled();
    expect(fixture.controller.pendingFailureEvent()).toMatchObject({ playerId: fixture.botId, attempt: 3, willRetry: false });
  });

  it("竞技场出口:重试耗尽把失败席位与错误信息交给 onRetriesExhausted", async () => {
    const exhausted = vi.fn();
    const fixture = createController({ onRetriesExhausted: exhausted, retryMaxAttempts: 1 });
    fixture.decide.mockRejectedValueOnce(new LlmDecisionError("request_error", "上游宕机", 100));

    await fixture.controller.handleTurn(fixture.botId, () => true);

    expect(exhausted).toHaveBeenCalledWith(fixture.botId, "上游宕机");
    expect(fixture.clock.setTimeout).not.toHaveBeenCalled();
  });

  it("retryManually:无待重试错误与回合已变化都抛中文错误,后者顺带自清过期标记", async () => {
    const fixture = createController();
    expect(() => fixture.controller.retryManually()).toThrow("当前没有可重试的 AI 出牌错误。");

    fixture.decide.mockRejectedValueOnce(new LlmDecisionError("request_error", "上游宕机", 100));
    await fixture.controller.handleTurn(fixture.botId, () => true);
    // 局面被推进:bot 的回合已经变化
    fixture.table.playCards(fixture.botId, ["4-diamonds"]);

    expect(() => fixture.controller.retryManually()).toThrow("AI 回合已经变化，不能重试上一手错误。");
    expect(fixture.controller.pendingFailureEvent()).toBeNull();
  });

  it("in-flight 去重:决策挂起期间重复 handleTurn 直接返回", async () => {
    const fixture = createController();
    let resolveDecide!: (action: BotAction) => void;
    fixture.decide.mockImplementationOnce(
      () =>
        new Promise<BotAction>((resolve) => {
          resolveDecide = resolve;
        })
    );

    const first = fixture.controller.handleTurn(fixture.botId, () => true);
    await fixture.controller.handleTurn(fixture.botId, () => true);
    expect(fixture.decide).toHaveBeenCalledTimes(1);

    resolveDecide({ type: "pass" });
    await first;
    expect(fixture.onApplyAction).toHaveBeenCalledTimes(1);
  });

  it("快照失效:isValid=false 或非当前回合都不发起决策", async () => {
    const fixture = createController();

    await fixture.controller.handleTurn(fixture.botId, () => false);
    await fixture.controller.handleTurn("bot:100031:2", () => true);

    expect(fixture.decide).not.toHaveBeenCalled();
  });

  it("锁内三连再校验:决策期间局面被推进则放弃落子,但仍收尾输出流", async () => {
    const fixture = createController();
    fixture.decide.mockImplementationOnce(async () => {
      fixture.table.playCards(fixture.botId, ["4-diamonds"]);
      return { type: "pass" } satisfies BotAction;
    });

    await fixture.controller.handleTurn(fixture.botId, () => true);

    expect(fixture.onApplyAction).not.toHaveBeenCalled();
    expect(fixture.onDecisionSettled).toHaveBeenCalledWith(fixture.botId);
  });

  it("非 LlmDecisionError 异常继续冒出(交给 scheduler→failRoom),且仍收尾输出流", async () => {
    const fixture = createController();
    fixture.decide.mockRejectedValueOnce(new Error("boom"));

    await expect(fixture.controller.handleTurn(fixture.botId, () => true)).rejects.toThrow("boom");

    expect(fixture.onDecisionSettled).toHaveBeenCalledWith(fixture.botId);
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });
});
