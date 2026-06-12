import { describe, expect, it, vi } from "vitest";
import { GameTable } from "@ddz/domain";
import type { InternalRoomStateResponse, RoomDto, RoomLiveStateEnvelope, RoomStatus } from "@ddz/protocol";
import type { RecordGameActionsInput } from "../../src/api/gameActionClient";
import { DdzRoom } from "../../src/rooms/DdzRoom";

const SETTLEMENT_DISPLAY_MS = 5000;

describe("DdzRoom crash recovery", () => {
  it("restores a playing room and resumes scheduling", async () => {
    const code = "RESTO1";
    const table = playingTable(code);
    const fixture = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));

    await fixture.room.onCreate(fixture.options);

    const snapshot = fixture.internals().table.snapshot();
    expect(snapshot.phase).toBe("playing");
    expect(snapshot.landlordId).toBe("human-1");
    // bot 名单从状态重建，真人座位等待重连
    expect(fixture.internals().botIds).toEqual([`bot:${code}:1`, `bot:${code}:2`]);
    expect(fixture.room.maxClients).toBe(1);
    expect(fixture.internals().nicknames.get("human-1")).toBe("Alice");
    expect(snapshot.players.find((player: { id: string }) => player.id === "human-1")?.connected).toBe(false);
    // 回合计时已重新调度（turn_timer 广播 + 计时器挂上）
    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "turn_timer", playerId: "human-1" })
    );

    await fixture.room.onDispose();
  });

  it("restores a settled room and schedules the next round", async () => {
    const code = "RESTO2";
    const table = playingTable(code);
    sweepToSettlement(table);
    const fixture = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));

    await fixture.room.onCreate(fixture.options);

    expect(fixture.internals().table.snapshot().phase).toBe("settled");
    // 结算已随 state 同事务落库，恢复后照常停留结算画面再开下一局
    expect(fixture.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), SETTLEMENT_DISPLAY_MS);

    await fixture.room.onDispose();
  });

  it("restores an inter-round room and re-readies bots", async () => {
    const code = "RESTO3";
    const table = playingTable(code);
    sweepToSettlement(table);
    table.resetForNextRound();
    const fixture = createRoomFixture(code, stateResponse(code, "open", envelope(table)));

    await fixture.room.onCreate(fixture.options);
    await fixture.flushTasks();

    const players = fixture.internals().table.snapshot().players as { id: string; kind: string; ready: boolean }[];
    expect(players.filter((player) => player.kind === "bot").every((player) => player.ready)).toBe(true);
    expect(players.find((player) => player.id === "human-1")?.ready).toBe(false);
    // bot 补 ready 走正常持久化路径
    expect(
      fixture.gameActions.flatMap((record) => record.actions.map((action) => action.type)).filter((type) => type === "player_ready")
    ).toHaveLength(2);

    await fixture.room.onDispose();
  });

  it("rejects closed rooms and rooms stuck in playing without recoverable state", async () => {
    const closed = createRoomFixture("RESTO4", stateResponse("RESTO4", "closed", null));
    await expect(closed.room.onCreate(closed.options)).rejects.toThrow("closed");

    const orphan = createRoomFixture("RESTO5", stateResponse("RESTO5", "playing", null));
    await expect(orphan.room.onCreate(orphan.options)).rejects.toThrow("no recoverable state");
  });

  it("rejects concurrent creation for the same room code until the live room disposes", async () => {
    const code = "RESTO6";
    const first = createRoomFixture(code, stateResponse(code, "open", null));
    await first.room.onCreate(first.options);

    // 并发逃逸兜底：同码第二实例直接失败
    const second = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(second.room.onCreate(second.options)).rejects.toThrow("already live");

    // 首实例销毁后注册释放，同码可重新创建（即恢复场景）
    await first.room.onDispose();
    const third = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(third.room.onCreate(third.options)).resolves.toBeUndefined();
    await third.room.onDispose();
  });

  it("releases the registration when onCreate fails", async () => {
    const code = "RESTO7";
    const failed = createRoomFixture(code, stateResponse(code, "closed", null));
    await expect(failed.room.onCreate(failed.options)).rejects.toThrow("closed");

    // onCreate 失败不触发 onDispose，注册必须已自清，否则房间码被永久占用
    const retry = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(retry.room.onCreate(retry.options)).resolves.toBeUndefined();
    await retry.room.onDispose();
  });
});

/** 真人地主 + 双 bot 的确定性 playing 局面 */
function playingTable(code: string): GameTable {
  const table = new GameTable();
  table.addPlayer("human-1");
  table.addBot(`bot:${code}:1`);
  table.addBot(`bot:${code}:2`);
  table.setReady(`bot:${code}:1`);
  table.setReady(`bot:${code}:2`);
  table.setReady("human-1");
  table.bidLandlord("human-1", true);
  table.robLandlord(`bot:${code}:1`, false);
  table.robLandlord(`bot:${code}:2`, false);
  return table;
}

function sweepToSettlement(table: GameTable): void {
  while (table.snapshot().phase === "playing") {
    const snapshot = table.snapshot();
    const current = snapshot.currentPlayerId!;
    if (current === snapshot.landlordId) {
      table.playCards(current, [table.getHand(current)[0]!.id]);
    } else {
      table.pass(current);
    }
  }
}

function envelope(table: GameTable): RoomLiveStateEnvelope {
  return {
    version: 1,
    table: table.dump(),
    nicknames: { "human-1": "Alice" }
  };
}

function stateResponse(code: string, status: RoomStatus, state: RoomLiveStateEnvelope | null): InternalRoomStateResponse {
  return {
    room: {
      id: `room-${code}`,
      code,
      status,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies RoomDto,
    state
  };
}

interface RoomFixture {
  readonly room: DdzRoom;
  readonly options: Record<string, unknown>;
  readonly broadcast: ReturnType<typeof vi.fn>;
  readonly clock: { setTimeout: ReturnType<typeof vi.fn> };
  readonly gameActions: RecordGameActionsInput[];
  internals(): Record<string, never> & {
    table: GameTable;
    botIds: string[];
    nicknames: Map<string, string>;
    tasks: { enqueue(task: () => Promise<void>): Promise<void> };
  };
  flushTasks(): Promise<void>;
}

let fixtureSequence = 0;

/** 裸实例 + 最小 Colyseus 桩，避免拉起完整运行时（与 ddzRoomFailRoom.test.ts 同风格） */
function createRoomFixture(code: string, response: InternalRoomStateResponse): RoomFixture {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const broadcast = vi.fn();
  const clock = {
    setTimeout: vi.fn(() => ({ clear: vi.fn() }))
  };
  const gameActions: RecordGameActionsInput[] = [];

  fixtureSequence += 1;
  Object.defineProperty(room, "roomId", { value: `colyseus-${fixtureSequence}`, configurable: true });
  Object.defineProperty(room, "clock", { value: clock, configurable: true });
  Object.defineProperty(room, "clients", { value: [], configurable: true });
  internals.broadcast = broadcast;
  internals.setMetadata = vi.fn();
  internals.setPrivate = vi.fn();
  internals.onMessage = vi.fn();

  const options = {
    roomCode: code,
    roomStatusClient: {
      async createRoom(): Promise<RoomDto> {
        throw new Error("Not used.");
      },
      async getRoomState(): Promise<InternalRoomStateResponse> {
        return response;
      },
      async updateRoomStatus(): Promise<void> {}
    },
    gameActionClient: {
      async recordGameActions(input: RecordGameActionsInput): Promise<void> {
        gameActions.push(input);
      }
    }
  };

  return {
    room,
    options,
    broadcast,
    clock,
    gameActions,
    internals: () => internals as ReturnType<RoomFixture["internals"]>,
    flushTasks: async () => {
      await (internals.tasks as { enqueue(task: () => Promise<void>): Promise<void> }).enqueue(async () => {});
    }
  };
}
