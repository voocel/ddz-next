import { describe, expect, it, vi } from "vitest";
import { GameTable } from "@ddz/domain";
import type { InternalRoomStateResponse, RoomDto, RoomLiveStateEnvelope, RoomStatus } from "@ddz/protocol";
import type { RecordGameActionsInput } from "../../src/api/gameActionClient";
import { DdzRoom } from "../../src/rooms/DdzRoom";
import { RuleBotBrain } from "../../src/rooms/ruleBotBrain";

describe("DdzRoom crash recovery", () => {
  it("restores a playing room and resumes scheduling", async () => {
    const code = "100011";
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

  it("restores a settled room and waits for a human ready command before the next round", async () => {
    const code = "100012";
    const table = playingTable(code);
    sweepToSettlement(table);
    const fixture = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));

    await fixture.room.onCreate(fixture.options);

    expect(fixture.internals().table.snapshot().phase).toBe("settled");
    // 结算态不再自动重开下一局,必须等真人点击准备。
    expect(fixture.clock.setTimeout).not.toHaveBeenCalled();

    await fixture.room.onDispose();
  });

  it("restores an inter-round room, releases offline human seats and re-readies bots", async () => {
    const code = "100013";
    const table = playingTable(code);
    sweepToSettlement(table);
    table.resetForNextRound();
    const fixture = createRoomFixture(code, stateResponse(code, "open", envelope(table)));

    await fixture.room.onCreate(fixture.options);
    await fixture.flushTasks();

    const players = fixture.internals().table.snapshot().players as { id: string; kind: string; ready: boolean }[];
    expect(players.filter((player) => player.kind === "bot").every((player) => player.ready)).toBe(true);
    // 局间相位的离线真人直接让座（永远等不到其 ready），重连走正常入房路径
    expect(players.find((player) => player.id === "human-1")).toBeUndefined();
    expect(fixture.internals().nicknames.has("human-1")).toBe(false);
    // bot 补 ready 走正常持久化路径
    expect(
      fixture.gameActions.flatMap((record) => record.actions.map((action) => action.type)).filter((type) => type === "player_ready")
    ).toHaveLength(2);

    await fixture.room.onDispose();
  });

  it("rejects closed rooms and rooms stuck in playing without recoverable state", async () => {
    const closed = createRoomFixture("100014", stateResponse("100014", "closed", null));
    await expect(closed.room.onCreate(closed.options)).rejects.toThrow("closed");

    const orphan = createRoomFixture("100015", stateResponse("100015", "playing", null));
    await expect(orphan.room.onCreate(orphan.options)).rejects.toThrow("no recoverable state");
  });

  it("rejects concurrent creation for the same room code until the live room disposes", async () => {
    const code = "100016";
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
    const code = "100017";
    const failed = createRoomFixture(code, stateResponse(code, "closed", null));
    await expect(failed.room.onCreate(failed.options)).rejects.toThrow("closed");

    // onCreate 失败需立即自清注册，否则房间码被永久占用
    const retry = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(retry.room.onCreate(retry.options)).resolves.toBeUndefined();
    await retry.room.onDispose();
  });

  it("never touches the DB when a failed-create zombie gets auto-disposed", async () => {
    const code = "100018";
    const zombie = createRoomFixture(code, stateResponse(code, "playing", null));
    await expect(zombie.room.onCreate(zombie.options)).rejects.toThrow("no recoverable state");

    // Colyseus 对 onCreate 失败的实例约 15s 后仍会触发 onDispose（autoDispose），
    // 此时绝不能 PATCH closed——那会删掉别人（或可恢复牌局）的状态行
    await zombie.room.onDispose();
    expect(zombie.statusUpdates).toEqual([]);
  });

  it("keeps the registration until closeRoom completes on dispose", async () => {
    const code = "100019";
    const table = playingTable(code);
    const first = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await first.room.onCreate(first.options);

    // 卡住 closed 上报：dispose 期间同码建房必须仍被注册表拒绝，
    // 否则新实例会在状态行删除前恢复，旧实例随后的 PATCH closed 把它的状态行也删掉
    let releaseClose: () => void = () => {};
    first.gateNextStatusUpdate(new Promise<void>((resolve) => (releaseClose = resolve)));
    const disposing = first.room.onDispose();

    const second = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await expect(second.room.onCreate(second.options)).rejects.toThrow("already live");

    releaseClose();
    await disposing;
    expect(first.statusUpdates).toEqual(["closed"]);

    const third = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await expect(third.room.onCreate(third.options)).resolves.toBeUndefined();
    await third.room.onDispose();
  });

  it("rejects bot settings updates in non-AI rooms", async () => {
    const code = "100021";
    const fixture = createRoomFixture(code, stateResponse(code, "open", null));
    await fixture.room.onCreate(fixture.options);
    const client = fixture.bindHumanClient("human-1");

    await fixture.handleCommand(client, {
      type: "update_bot_settings",
      provider: "",
      model: "",
      reasoningEffort: "off"
    });

    expect(client.send).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "command_rejected", reason: "当前房间不支持动态更新 AI 配置。" })
    );
    expect(fixture.internals().botBrain).toBeInstanceOf(RuleBotBrain);

    await fixture.room.onDispose();
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
  readonly clock: { setTimeout: ReturnType<typeof vi.fn>; setInterval: ReturnType<typeof vi.fn> };
  readonly gameActions: RecordGameActionsInput[];
  /** 房间上报过的状态序列（updateRoomStatus 调用记录） */
  readonly statusUpdates: string[];
  /** 让下一次 updateRoomStatus 挂起到给定 promise 解决，用于验证 dispose 期间的竞态 */
  gateNextStatusUpdate(gate: Promise<void>): void;
  internals(): Record<string, never> & {
    botBrain: unknown;
    table: GameTable;
    botIds: string[];
    clientPlayers: Map<string, string>;
    nicknames: Map<string, string>;
    tasks: { enqueue(task: () => Promise<void>): Promise<void> };
  };
  bindHumanClient(playerId: string): { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> };
  handleCommand(client: { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> }, payload: unknown): Promise<void>;
  flushTasks(): Promise<void>;
}

let fixtureSequence = 0;

/** 裸实例 + 最小 Colyseus 桩，避免拉起完整运行时（与 ddzRoomFailRoom.test.ts 同风格） */
function createRoomFixture(code: string, response: InternalRoomStateResponse): RoomFixture {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const broadcast = vi.fn();
  const clock = {
    setTimeout: vi.fn(() => ({ clear: vi.fn() })),
    setInterval: vi.fn(() => ({ clear: vi.fn() }))
  };
  const gameActions: RecordGameActionsInput[] = [];
  const statusUpdates: string[] = [];
  let statusGate: Promise<void> | null = null;

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
      async updateRoomStatus(_code: string, status: string): Promise<void> {
        if (statusGate) {
          const gate = statusGate;
          statusGate = null;
          await gate;
        }
        statusUpdates.push(status);
      }
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
    statusUpdates,
    gateNextStatusUpdate: (gate: Promise<void>) => {
      statusGate = gate;
    },
    internals: () => internals as ReturnType<RoomFixture["internals"]>,
    bindHumanClient: (playerId: string) => {
      const client = { sessionId: `session-${playerId}`, send: vi.fn() };
      (internals.table as GameTable).addPlayer(playerId);
      (internals.clientPlayers as Map<string, string>).set(client.sessionId, playerId);
      return client;
    },
    handleCommand: (client, payload) =>
      (room as unknown as { handleCommand(client: unknown, payload: unknown): Promise<void> }).handleCommand(client, payload),
    flushTasks: async () => {
      await (internals.tasks as { enqueue(task: () => Promise<void>): Promise<void> }).enqueue(async () => {});
    }
  };
}
