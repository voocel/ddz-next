import { describe, expect, it } from "vitest";
import type { GameSnapshot, GamePhase } from "@ddz/domain";
import { mapSnapshotToRoomStatus } from "../../src/rooms/statusMapping";

describe("mapSnapshotToRoomStatus", () => {
  it("maps active round phases to playing", () => {
    for (const phase of ["bidding", "robbing", "playing"] as const) {
      expect(mapSnapshotToRoomStatus(createSnapshot(phase))).toBe("playing");
    }
  });

  it("maps settled rounds to playing because the room is waiting for next-round ready", () => {
    expect(mapSnapshotToRoomStatus(createSnapshot("settled"))).toBe("playing");
  });

  it("maps empty disconnected pre-game rooms to open", () => {
    expect(
      mapSnapshotToRoomStatus({
        ...createSnapshot("waiting"),
        players: []
      })
    ).toBe("open");
  });

  it("maps bot-only pre-game rooms to open after the last human leaves", () => {
    expect(
      mapSnapshotToRoomStatus({
        ...createSnapshot("waiting"),
        players: [
          { id: "bot:test:1", kind: "bot", seat: 0, ready: true, handCount: 0, connected: true, score: 0 },
          { id: "bot:test:2", kind: "bot", seat: 1, ready: true, handCount: 0, connected: true, score: 0 }
        ]
      })
    ).toBe("open");
  });

  it("maps pre-game rooms with a connected human and an empty seat to open", () => {
    expect(
      mapSnapshotToRoomStatus({
        ...createSnapshot("waiting"),
        players: [
          { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
          { id: "bot:test:1", kind: "bot", seat: 1, ready: true, handCount: 0, connected: true, score: 0 }
        ]
      })
    ).toBe("open");
  });

  it("maps ready rooms with empty seats back to open so players can join", () => {
    expect(
      mapSnapshotToRoomStatus({
        ...createSnapshot("ready"),
        players: [
          { id: "p0", kind: "human", seat: 0, ready: true, handCount: 0, connected: true, score: 0 },
          { id: "bot:test:1", kind: "bot", seat: 1, ready: true, handCount: 0, connected: true, score: 0 }
        ]
      })
    ).toBe("open");
  });

  it("maps full ready rooms to playing so they stop being matched", () => {
    expect(mapSnapshotToRoomStatus(createSnapshot("ready"))).toBe("playing");
  });
});

function createSnapshot(phase: GamePhase): GameSnapshot {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "p1", kind: "human", seat: 1, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: false, handCount: 0, connected: true, score: 0 }
    ],
    currentPlayerId: null,
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}
