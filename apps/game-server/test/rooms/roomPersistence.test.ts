import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@ddz/domain";
import type { InternalRoomStateResponse, RoomDto, RoomLiveStateEnvelope, RoomStatus } from "@ddz/protocol";
import type { GameActionClient } from "../../src/api/gameActionClient";
import type { RoomStatusClient } from "../../src/api/roomStatusClient";
import { RoomPersistence, RoomPersistenceError } from "../../src/rooms/roomPersistence";

describe("RoomPersistence", () => {
  it("records actions with snapshots and syncs changed room status once", async () => {
    const roomStatusClient = new FakeRoomStatusClient();
    const gameActionClient = new FakeGameActionClient();
    const persistence = new RoomPersistence("ROOM01", roomStatusClient, gameActionClient, liveStateEnvelope);
    const playingSnapshot = createSnapshot("playing");

    await persistence.recordMutation({
      actions: [
        {
          type: "landlord_bid",
          playerId: "p0",
          payload: {
            called: true
          }
        }
      ],
      snapshot: playingSnapshot
    });
    await persistence.recordMutation({
      actions: [
        {
          type: "landlord_robbed",
          playerId: "bot:room:1",
          payload: {
            robbed: false
          }
        }
      ],
      snapshot: playingSnapshot
    });

    expect(gameActionClient.records).toHaveLength(2);
    expect(gameActionClient.records[0]?.actions[0]).toMatchObject({
      playerId: "p0",
      playerKind: "human",
      type: "landlord_bid",
      payload: {
        called: true,
        snapshot: expect.objectContaining({
          phase: "playing"
        })
      }
    });
    expect(gameActionClient.records[1]?.actions[0]).toMatchObject({
      playerId: "bot:room:1",
      playerKind: "bot"
    });
    // 每个 mutation 都随动作携带崩溃恢复信封
    expect(gameActionClient.records.every((record) => record.state?.version === 1)).toBe(true);
    expect(roomStatusClient.statusUpdates).toEqual([{ roomCode: "ROOM01", status: "playing" }]);
  });

  it("uses explicit player kind overrides for players already removed from snapshots", async () => {
    const roomStatusClient = new FakeRoomStatusClient();
    const gameActionClient = new FakeGameActionClient();
    const persistence = new RoomPersistence("ROOM01", roomStatusClient, gameActionClient, liveStateEnvelope);

    await persistence.recordMutation({
      actions: [
        {
          type: "player_left",
          playerId: "p0",
          playerKindOverride: "human",
          payload: {}
        }
      ],
      snapshot: {
        ...createSnapshot("waiting"),
        players: []
      }
    });

    expect(gameActionClient.records[0]?.actions[0]).toMatchObject({
      playerId: "p0",
      playerKind: "human",
      type: "player_left"
    });
    expect(roomStatusClient.statusUpdates).toEqual([{ roomCode: "ROOM01", status: "open" }]);
  });

  it("closes and records failed rooms", async () => {
    const roomStatusClient = new FakeRoomStatusClient();
    const gameActionClient = new FakeGameActionClient();
    const persistence = new RoomPersistence("ROOM01", roomStatusClient, gameActionClient, liveStateEnvelope);

    await persistence.closeFailedRoom("persist failed", createSnapshot("playing"));

    expect(roomStatusClient.statusUpdates).toEqual([{ roomCode: "ROOM01", status: "closed" }]);
    expect(gameActionClient.records).toEqual([
      {
        roomCode: "ROOM01",
        mutationId: expect.any(String),
        actions: [
          expect.objectContaining({
            playerId: null,
            playerKind: null,
            type: "room_failed",
            payload: expect.objectContaining({
              reason: "persist failed",
              snapshot: expect.objectContaining({
                phase: "playing"
              })
            })
          })
        ]
      }
    ]);
  });

  it("wraps persistence failures with an explicit room persistence error", async () => {
    const roomStatusClient = new FakeRoomStatusClient();
    const gameActionClient = new FakeGameActionClient();
    gameActionClient.failRecords = true;
    const persistence = new RoomPersistence("ROOM01", roomStatusClient, gameActionClient, liveStateEnvelope);

    await expect(
      persistence.recordMutation({
        actions: [
          {
            type: "player_ready",
            playerId: "p0",
            payload: {}
          }
        ],
        snapshot: createSnapshot("ready")
      })
    ).rejects.toBeInstanceOf(RoomPersistenceError);
  });
});

class FakeRoomStatusClient implements RoomStatusClient {
  readonly statusUpdates: { readonly roomCode: string; readonly status: string }[] = [];

  async createRoom(): Promise<RoomDto> {
    throw new Error("Not used in these tests.");
  }

  async getRoomState(roomCode: string): Promise<InternalRoomStateResponse> {
    throw new Error(`Not used in these tests: ${roomCode}`);
  }

  async updateRoomStatus(roomCode: string, status: RoomStatus): Promise<void> {
    this.statusUpdates.push({ roomCode, status });
  }
}

/** 与 DdzRoom.dumpLiveState 同构的最小信封 */
function liveStateEnvelope(): RoomLiveStateEnvelope {
  return {
    version: 1,
    table: {
      phase: "waiting",
      players: [],
      currentPlayerId: null,
      landlordId: null,
      bidCandidateId: null,
      landlordCards: [],
      bottomCards: [],
      lastPlay: null,
      settlement: null,
      passCount: 0,
      bidAttempts: 0,
      robQueue: [],
      robIndex: 0,
      robCount: 0,
      bombCount: 0,
      playCounts: {}
    },
    nicknames: {}
  };
}

class FakeGameActionClient implements GameActionClient {
  readonly records: Parameters<GameActionClient["recordGameActions"]>[0][] = [];
  failRecords = false;

  async recordGameActions(input: Parameters<GameActionClient["recordGameActions"]>[0]): Promise<void> {
    if (this.failRecords) {
      throw new Error("record failed");
    }
    this.records.push(input);
  }
}

function createSnapshot(phase: GameSnapshot["phase"]): GameSnapshot {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "bot:room:1", kind: "bot", seat: 1, ready: true, handCount: 0, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: false, handCount: 0, connected: true, score: 0 }
    ],
    currentPlayerId: phase === "waiting" || phase === "ready" || phase === "settled" ? null : "p0",
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    settlement: null
  };
}
