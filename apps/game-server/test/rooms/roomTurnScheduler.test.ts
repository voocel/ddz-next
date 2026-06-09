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

  it("enqueues bot turn callbacks when the scheduled bot timer fires", async () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    fixture.clock.fire(0);

    expect(fixture.enqueuedTasks).toHaveLength(1);
    await fixture.enqueuedTasks[0]?.();
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

  it("does not schedule turn timers for phases without active turns", () => {
    const fixture = createFixture();
    const scheduler = createScheduler(fixture, []);

    scheduler.scheduleTurnTimer(createSnapshot("ready", null));

    expect(fixture.turnTimers).toEqual([]);
    expect(fixture.clock.handles).toEqual([]);
  });

  it("routes scheduled task failures to the room failure handler", async () => {
    const fixture = createFixture();
    fixture.failBotTurn = true;
    const scheduler = createScheduler(fixture, ["bot:room:1"]);

    scheduler.scheduleBotTurn(createSnapshot("playing", "bot:room:1"));
    fixture.clock.fire(0);
    await fixture.enqueuedTasks[0]?.();

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
    botMoveDelayMs: 50,
    clock: fixture.clock,
    enqueue: (task) => {
      fixture.enqueuedTasks.push(task);
    },
    onBotTurn: async (playerId) => {
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
    turnTimeoutMs: 1000
  });
}

interface Fixture {
  readonly botTurns: PlayerId[];
  readonly clock: FakeClock;
  readonly enqueuedTasks: (() => Promise<void>)[];
  failBotTurn: boolean;
  readonly failures: { readonly message: string; readonly reason: string }[];
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
    timeoutTurns: [],
    turnTimers: []
  };
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
    settlement: null
  };
}
