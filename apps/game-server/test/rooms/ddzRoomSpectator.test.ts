import { describe, expect, it, vi } from "vitest";
import { GameTable } from "@ddz/domain";
import type { RoomLiveStateEnvelope } from "@ddz/protocol";
import { DdzRoom } from "../../src/rooms/DdzRoom";

interface FakeClient {
  readonly sessionId: string;
  readonly send: ReturnType<typeof vi.fn>;
  auth?: { sub: string; nickname?: string };
}

interface Fixture {
  readonly room: DdzRoom;
  readonly internals: Record<string, unknown>;
  readonly table: GameTable;
  readonly addClient: (client: FakeClient) => void;
  readonly invoke: <T>(method: string, ...args: unknown[]) => T;
}

function createFixture(): Fixture {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const table = playingTable();

  internals.roomCode = "100031";
  internals.table = table;
  internals.nicknames = new Map([["human-1", "Alice"]]);
  internals.turnScheduler = {
    getActiveTurnTimer: () => null,
    scheduleTurnTimer: vi.fn(),
    scheduleBotTurn: vi.fn(),
    cancelAll: vi.fn()
  };
  internals.persistence = {
    recordMutation: vi.fn(async () => {})
  };
  internals.failed = false;

  return {
    room,
    internals,
    table,
    addClient: (client) => {
      (room.clients as unknown as FakeClient[]).push(client);
    },
    invoke: (method, ...args) => (room as unknown as Record<string, (...args: unknown[]) => never>)[method]!(...args)
  };
}

describe("DdzRoom spectator", () => {
  it("观众入场:登记会话并补发公开视角快照(无手牌),不动牌桌", () => {
    const fixture = createFixture();
    const client: FakeClient = { sessionId: "spec-1", send: vi.fn() };

    fixture.invoke("handleSpectatorJoin", client);

    expect((fixture.internals.spectatorSessions as Set<string>).has("spec-1")).toBe(true);
    expect(client.send).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "snapshot", hand: [] })
    );
    expect(fixture.table.snapshot().players).toHaveLength(3);
  });

  it("个性化事件同时覆盖入座玩家(自己手牌)与观众(空手牌),未登记会话不发", () => {
    const fixture = createFixture();
    const seated: FakeClient = { sessionId: "s-seated", send: vi.fn() };
    const spectator: FakeClient = { sessionId: "s-spec", send: vi.fn() };
    const stranger: FakeClient = { sessionId: "s-none", send: vi.fn() };
    fixture.addClient(seated);
    fixture.addClient(spectator);
    fixture.addClient(stranger);
    (fixture.internals.clientPlayers as Map<string, string>).set("s-seated", "human-1");
    (fixture.internals.spectatorSessions as Set<string>).add("s-spec");

    fixture.invoke("broadcastPersonalSnapshot", "snapshot", fixture.table.snapshot());

    expect(seated.send).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "snapshot", hand: [expect.objectContaining({ id: "3-diamonds" })] })
    );
    expect(spectator.send).toHaveBeenCalledWith("event", expect.objectContaining({ type: "snapshot", hand: [] }));
    expect(stranger.send).not.toHaveBeenCalled();
  });

  it("观众离场只清会话:不落库、不广播、不动座位", async () => {
    const fixture = createFixture();
    (fixture.internals.spectatorSessions as Set<string>).add("s-spec");
    const recordMutation = (fixture.internals.persistence as { recordMutation: ReturnType<typeof vi.fn> }).recordMutation;

    await fixture.invoke<Promise<void>>("handleLeave", { sessionId: "s-spec", send: vi.fn() });

    expect((fixture.internals.spectatorSessions as Set<string>).size).toBe(0);
    expect(recordMutation).not.toHaveBeenCalled();
    expect(fixture.table.snapshot().players).toHaveLength(3);
  });

  it("满座后非观战 join 被显式拒绝并提示可观战", async () => {
    const fixture = createFixture();
    const client: FakeClient = { sessionId: "x-1", send: vi.fn(), auth: { sub: "human-9" } };

    await expect(fixture.invoke<Promise<void>>("handleJoin", client, { roomCode: "100031" })).rejects.toThrow(
      /牌桌已满员.*观战/
    );
  });

  it("竞技场房的非观战 join 提示只能观战", async () => {
    const fixture = createFixture();
    fixture.internals.arena = true;
    const client: FakeClient = { sessionId: "x-2", send: vi.fn(), auth: { sub: "human-9" } };

    await expect(fixture.invoke<Promise<void>>("handleJoin", client, { roomCode: "100031" })).rejects.toThrow(
      /全 AI 对战.*观战/
    );
  });

  it("观战 join 走观众分流:不占座、拿到快照", async () => {
    const fixture = createFixture();
    const client: FakeClient = { sessionId: "spec-2", send: vi.fn(), auth: { sub: "human-9" } };

    await fixture.invoke<Promise<void>>("handleJoin", client, { roomCode: "100031", spectate: true });

    expect((fixture.internals.spectatorSessions as Set<string>).has("spec-2")).toBe(true);
    expect(client.send).toHaveBeenCalledWith("event", expect.objectContaining({ type: "snapshot", hand: [] }));
    expect(fixture.table.snapshot().players.map((player) => player.id)).not.toContain("human-9");
  });
});

function playingTable(): GameTable {
  const table = new GameTable();
  table.restore({
    phase: "playing",
    players: [
      { id: "human-1", kind: "human", seat: 0, ready: false, connected: true, hand: ["3-diamonds"], score: 0 },
      { id: "bot:100031:1", kind: "bot", seat: 1, ready: false, connected: true, hand: ["4-diamonds"], score: 0 },
      { id: "bot:100031:2", kind: "bot", seat: 2, ready: false, connected: true, hand: ["5-diamonds"], score: 0 }
    ],
    currentPlayerId: "bot:100031:1",
    landlordId: "human-1",
    bidCandidateId: null,
    firstBidderId: null,
    landlordCards: ["6-diamonds", "7-diamonds", "8-diamonds"],
    bottomCards: [],
    lastPlay: { playerId: "human-1", cards: ["3-diamonds"] },
    settlement: null,
    passCount: 0,
    bidAttempts: 0,
    robQueue: [],
    robIndex: 0,
    robCount: 0,
    bombCount: 0,
    playCounts: { "human-1": 1 },
    playHistory: [{ type: "play", playerId: "human-1", cards: ["3-diamonds"] }]
  } satisfies RoomLiveStateEnvelope["table"]);
  return table;
}
