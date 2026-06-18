import { describe, expect, it } from "vitest";
import type { GameSnapshot, PlayerId } from "@ddz/domain";
import { RoomTurnScheduler } from "../../src/rooms/roomTurnScheduler";

describe("RoomTurnScheduler", () => {
  it("schedules only active bot turns and cancels stale timers", () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    scheduler.scheduleBotTurn(createSnapshot("playing", "p0"));

    expect(fixture.clock.handles[0]?.cleared).toBe(true);
    fixture.clock.fire(0);
    expect(fixture.botTurns).toEqual([]);
    expect(fixture.enqueuedTasks).toHaveLength(0);
  });

  it("runs bot turns off the serial queue when the scheduled bot timer fires", async () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    fixture.clock.fire(0);
    await flushMicrotasks();

    // 决策在锁外触发,不再经过 enqueue(让慢速 LLM 不持有串行锁)
    expect(fixture.enqueuedTasks).toHaveLength(0);
    expect(fixture.botTurns).toEqual(["bot:room:1"]);
  });

  it("broadcasts turn timer events and enqueues timeout callbacks for active turns", async () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleTurnTimer(createSnapshot("playing", "p0"));

    expect(fixture.turnTimers).toHaveLength(1);
    expect(fixture.turnTimers[0]).toMatchObject({
      playerId: "p0",
      durationMs: 1000,
      snapshot: expect.objectContaining({
        phase: "playing"
      })
    });

    fixture.clock.fire(0);
    await fixture.enqueuedTasks[0]?.();
    expect(fixture.timeoutTurns).toEqual(["p0"]);
  });

  it("broadcasts a cosmetic turn timer for bot turns without scheduling a rule timeout", () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleTurnTimer(createSnapshot("playing", "bot:room:1"));

    // bot 回合也广播倒计时(视觉与真人一致),时长用 botTurnTimerMs
    expect(fixture.turnTimers).toHaveLength(1);
    expect(fixture.turnTimers[0]).toMatchObject({ playerId: "bot:room:1", durationMs: 2000 });
    expect(scheduler.getActiveTurnTimer()).toMatchObject({ playerId: "bot:room:1", durationMs: 2000 });
    // 但绝不为 bot 安排规则型超时兜底:无定时器、无入队任务(动作由 scheduleBotTurn 驱动,LLM 超时自管)
    expect(fixture.clock.handles).toEqual([]);
    expect(fixture.enqueuedTasks).toHaveLength(0);
  });

  it("does not schedule turn timers for phases without active turns", () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, []);

    scheduler.scheduleTurnTimer(createSnapshot("ready", null));

    expect(fixture.turnTimers).toEqual([]);
    expect(fixture.clock.handles).toEqual([]);
  });

  it("drops queued turn timeout tasks when the turn changed before execution", async () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, []);

    scheduler.scheduleTurnTimer(createSnapshot("playing", "p0"));
    fixture.clock.fire(0);
    expect(fixture.enqueuedTasks).toHaveLength(1);

    // 任务入队后、执行前回合推进（token 变化），迟到的超时任务应放弃执行
    scheduler.scheduleTurnTimer(createSnapshot("playing", "p2"));
    await fixture.enqueuedTasks[0]?.();

    expect(fixture.timeoutTurns).toEqual([]);
  });

  it("hands onBotTurn an isValid predicate that goes false once the schedule is cancelled", async () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    fixture.clock.fire(0);
    await flushMicrotasks();

    // 触发当下有效;cancelAll 后 isValid 失效——房间据此丢弃锁外算出的过期决策
    expect(fixture.lastIsValid?.()).toBe(true);
    scheduler.cancelAll();
    expect(fixture.lastIsValid?.()).toBe(false);
  });

  it("exposes the active turn timer and clears it on cancel", () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, []);

    expect(scheduler.getActiveTurnTimer()).toBeNull();
    scheduler.scheduleTurnTimer(createSnapshot("playing", "p0"));
    expect(scheduler.getActiveTurnTimer()).toMatchObject({
      playerId: "p0",
      durationMs: 1000
    });

    scheduler.cancelAll();
    expect(scheduler.getActiveTurnTimer()).toBeNull();
  });

  it("routes bot turn failures to the room failure handler", async () => {
    const fixture = createFixture();
    fixture.failBotTurn = true;
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    fixture.clock.fire(0);
    await flushMicrotasks();

    expect(fixture.failures).toEqual([
      {
        message: "bot failed",
        reason: "Bot action failed."
      }
    ]);
  });
});

function createScheduler(fixture: Fixture, botIds: readonly PlayerId[]): RoomTurnScheduler {
  return new RoomTurnScheduler({
    botIds,
    nextBotDelayMs: () => 50,
    clock: fixture.clock,
    enqueue: (task) => {
      fixture.enqueuedTasks.push(task);
    },
    onBotTurn: async (playerId, isValid) => {
      fixture.lastIsValid = isValid;
      if (fixture.failBotTurn) {
        throw new Error("bot failed");
      }
      fixture.botTurns.push(playerId);
    },
    onFailure: async (error, reason) => {
      fixture.failures.push({
        message: error instanceof Error ? error.message : String(error),
        reason
      });
    },
    onTurnTimeout: async (playerId) => {
      fixture.timeoutTurns.push(playerId);
    },
    onTurnTimer: (event) => {
      fixture.turnTimers.push(event);
    },
    turnTimeoutMs: 1000,
    botTurnTimerMs: 2000
  });
}

interface Fixture {
  readonly botTurns: PlayerId[];
  readonly clock: FakeClock;
  readonly enqueuedTasks: (() => Promise<void>)[];
  failBotTurn: boolean;
  readonly failures: { readonly message: string; readonly reason: string }[];
  lastIsValid: (() => boolean) | null;
  readonly timeoutTurns: PlayerId[];
  readonly turnTimers: {
    readonly deadlineAt: string;
    readonly durationMs: number;
    readonly playerId: PlayerId;
    readonly snapshot: GameSnapshot;
  }[];
}

function createFixture(): Fixture {
  return {
    botTurns: [],
    clock: new FakeClock(),
    enqueuedTasks: [],
    failBotTurn: false,
    failures: [],
    lastIsValid: null,
    timeoutTurns: [],
    turnTimers: []
  };
}

// bot 回合在锁外 fire-and-forget 执行,用一个宏任务把挂起的微任务跑完再断言。
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeClock {
  readonly handles: FakeTimerHandle[] = [];

  setTimeout(callback: () => void): FakeTimerHandle {
    const handle = new FakeTimerHandle(callback);
    this.handles.push(handle);
    return handle;
  }

  fire(index: number): void {
    const handle = this.handles[index];
    if (!handle || handle.cleared) {
      return;
    }
    handle.callback();
  }
}

class FakeTimerHandle {
  cleared = false;

  constructor(readonly callback: () => void) {}

  clear(): void {
    this.cleared = true;
  }
}

function createSnapshot(phase: GameSnapshot["phase"], currentPlayerId: PlayerId | null): GameSnapshot {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "bot:room:1", kind: "bot", seat: 1, ready: true, handCount: 0, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: false, handCount: 0, connected: true, score: 0 }
    ],
    currentPlayerId,
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}
