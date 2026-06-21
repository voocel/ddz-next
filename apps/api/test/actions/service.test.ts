import { describe, expect, it } from "vitest";
import { GameActionService } from "../../src/actions/service";
import { InMemoryGameActionRepository } from "../helpers";

describe("GameActionService", () => {
  it("records room events without creating a round", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100001", "room-1");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "100001",
      ownerId: "owner-1",
      mutationId: mutationId(1),
      actions: [
        {
          playerId: "user-1",
          playerKind: "human",
          type: "player_joined",
          payload: {
            seat: 0
          }
        },
        {
          playerId: "user-1",
          playerKind: "human",
          type: "player_ready",
          payload: {}
        }
      ]
    });

    expect(recorded.roundId).toBeNull();
    expect(recorded.roomEventIds).toEqual(["room-event-1", "room-event-2"]);
    expect(recorded.actionIds).toEqual([]);
    expect(repository.rounds).toHaveLength(0);
    expect(repository.roomEvents.map((event) => event.type)).toEqual(["player_joined", "player_ready"]);
  });

  it("creates a round only when round_started is recorded", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100005", "room-5");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "100005",
      ownerId: "owner-1",
      mutationId: mutationId(2),
      actions: [
        {
          playerId: null,
          playerKind: null,
          type: "round_started",
          payload: {
            currentPlayerId: "p0"
          }
        }
      ]
    });

    expect(recorded.roundId).toBe("round-1");
    expect(repository.rounds).toHaveLength(1);
    expect(repository.actions.map((action) => action.type)).toEqual(["round_started"]);
  });

  it("preserves initial hands on round_started replay payloads", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100012", "room-12");
    const service = new GameActionService(repository);

    await service.record({
      roomCode: "100012",
      ownerId: "owner-1",
      mutationId: mutationId(12),
      actions: [
        {
          playerId: null,
          playerKind: null,
          type: "round_started",
          payload: {
            currentPlayerId: "p0",
            initialHands: {
              p0: ["3-clubs", "SJ"],
              p1: ["4-hearts"],
              p2: ["5-spades"]
            }
          }
        }
      ]
    });

    expect(repository.actions[0]?.payload).toMatchObject({
      currentPlayerId: "p0",
      initialHands: {
        p0: ["3-clubs", "SJ"],
        p1: ["4-hearts"],
        p2: ["5-spades"]
      }
    });
  });

  it("rejects missing rooms", async () => {
    const service = new GameActionService(new InMemoryGameActionRepository());

    await expect(
      service.record({
        roomCode: "100001",
        ownerId: "owner-1",
        mutationId: mutationId(3),
        actions: [
          {
            playerId: null,
            playerKind: null,
            type: "player_joined",
            payload: {}
          }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("applies coin settlement from round_settled actions", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100002", "room-2");
    await repository.seedRound("room-2");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "100002",
      ownerId: "owner-1",
      mutationId: mutationId(4),
      actions: [
        {
          playerId: "p0",
          playerKind: "human",
          type: "round_settled",
          payload: {
            settlement: {
              winnerId: "p0",
              landlordId: "p0",
              landlordWon: true,
              baseScore: 1,
              players: [
                { playerId: "p0", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
                { playerId: "p1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
                { playerId: "p2", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
              ]
            }
          }
        }
      ]
    });

    expect(recorded.roundId).toBe("round-1");
    expect(repository.actions.map((action) => action.type)).toEqual(["round_settled"]);
    expect(repository.settlements).toEqual([
      {
        roundId: "round-1",
        landlordId: "p0",
        players: [
          { playerId: "p0", playerKind: "human", seat: 0, scoreDelta: 2 },
          { playerId: "p1", playerKind: "human", seat: 1, scoreDelta: -1 },
          { playerId: "p2", playerKind: "human", seat: 2, scoreDelta: -1 }
        ]
      }
    ]);
    expect(repository.coinLedgerPlayerIds).toEqual(["p0", "p1", "p2"]);
  });

  it("returns recorded mutation results without replaying settlement side effects", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100006", "room-6");
    await repository.seedRound("room-6");
    const service = new GameActionService(repository);
    const input = {
      roomCode: "100006",
      ownerId: "owner-1",
      mutationId: mutationId(5),
      actions: [
        {
          playerId: "p0",
          playerKind: "human" as const,
          type: "round_settled" as const,
          payload: createSettlementPayload("p0")
        }
      ]
    };

    const first = await service.record(input);
    const second = await service.record(input);

    expect(second).toEqual(first);
    expect(repository.actions).toHaveLength(1);
    expect(repository.settlements).toHaveLength(1);
    expect(repository.coinLedgerPlayerIds).toEqual(["p0", "p1", "p2"]);
  });

  it("rejects reused mutation ids with different actions", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100007", "room-7");
    const service = new GameActionService(repository);
    const reusedMutationId = mutationId(6);

    await service.record({
      roomCode: "100007",
      ownerId: "owner-1",
      mutationId: reusedMutationId,
      actions: [
        {
          playerId: "user-1",
          playerKind: "human",
          type: "player_joined",
          payload: {
            seat: 0
          }
        }
      ]
    });

    await expect(
      service.record({
        roomCode: "100007",
        ownerId: "owner-1",
        mutationId: reusedMutationId,
        actions: [
          {
            playerId: "user-1",
            playerKind: "human",
            type: "player_joined",
            payload: {
              seat: 1
            }
          }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });
    expect(repository.roomEvents).toHaveLength(1);
  });

  it("keeps bot settlement players out of human coin ledgers", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100004", "room-4");
    await repository.seedRound("room-4");
    const service = new GameActionService(repository);

    await service.record({
      roomCode: "100004",
      ownerId: "owner-1",
      mutationId: mutationId(7),
      actions: [
        {
          playerId: "bot:100004:1",
          playerKind: "bot",
          type: "round_settled",
          payload: {
            settlement: {
              winnerId: "bot:100004:1",
              landlordId: "bot:100004:1",
              landlordWon: true,
              baseScore: 1,
              players: [
                { playerId: "bot:100004:1", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
                { playerId: "p1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
                { playerId: "bot:100004:2", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
              ]
            }
          }
        }
      ]
    });

    expect(repository.settlements[0]?.players).toEqual([
      { playerId: "bot:100004:1", playerKind: "bot", seat: 0, scoreDelta: 2 },
      { playerId: "p1", playerKind: "human", seat: 1, scoreDelta: -1 },
      { playerId: "bot:100004:2", playerKind: "bot", seat: 2, scoreDelta: -1 }
    ]);
    expect(repository.coinLedgerPlayerIds).toEqual(["p1"]);
  });

  it("rejects a duplicate settlement carried by a different mutation id", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100008", "room-8");
    await repository.seedRound("room-8");
    const service = new GameActionService(repository);

    await service.record({
      roomCode: "100008",
      ownerId: "owner-1",
      mutationId: mutationId(10),
      actions: [
        {
          playerId: "p0",
          playerKind: "human",
          type: "round_settled",
          payload: createSettlementPayload("p0")
        }
      ]
    });

    // 不同 mutationId 二次结算同一局：该局已结束、不存在 open round → 拒绝，金币不重复入账
    await expect(
      service.record({
        roomCode: "100008",
        ownerId: "owner-1",
        mutationId: mutationId(11),
        actions: [
          {
            playerId: "p0",
            playerKind: "human",
            type: "round_settled",
            payload: createSettlementPayload("p0")
          }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });

    expect(repository.settlements).toHaveLength(1);
    expect(repository.coinLedgerPlayerIds).toEqual(["p0", "p1", "p2"]);
  });

  it("rejects round actions without an open round", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100003", "room-3");
    const service = new GameActionService(repository);

    await expect(
      service.record({
        roomCode: "100003",
        ownerId: "owner-1",
        mutationId: mutationId(8),
        actions: [
          {
            playerId: "p0",
            playerKind: "human",
            type: "round_settled",
            payload: {
              settlement: {
                winnerId: "p0",
                landlordId: "p0",
                landlordWon: true,
                baseScore: 1,
                players: [
                  { playerId: "p0", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
                  { playerId: "p1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
                  { playerId: "p2", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
                ]
              }
            }
          }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });

    expect(repository.actions).toHaveLength(0);
    expect(repository.settlements).toHaveLength(0);
  });

  it("stores the live state envelope alongside actions and stays idempotent on retry", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100009", "room-9");
    const service = new GameActionService(repository);

    const request = {
      roomCode: "100009",
      ownerId: "owner-1",
      mutationId: mutationId(9),
      actions: [
        {
          playerId: "user-1",
          playerKind: "human" as const,
          type: "player_joined" as const,
          payload: { seat: 0 }
        }
      ],
      state: liveStateEnvelope()
    };

    await service.record(request);
    expect(repository.liveStates.get("room-9")).toEqual(request.state);
    expect(repository.mutations.size).toBe(1);

    // 幂等重试：命中已有 mutation 提前返回，不重复落任何记录
    await service.record(request);
    expect(repository.mutations.size).toBe(1);
    expect(repository.roomEvents).toHaveLength(1);
  });

  it("includes room status in the mutation fingerprint and closes live state explicitly", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.seedRoom("100010", "room-10");
    const service = new GameActionService(repository);
    const mutationIdValue = mutationId(13);

    await service.record({
      roomCode: "100010",
      ownerId: "owner-1",
      mutationId: mutationIdValue,
      status: "playing",
      actions: [
        {
          playerId: "user-1",
          playerKind: "human",
          type: "player_joined",
          payload: { seat: 0 }
        }
      ],
      state: liveStateEnvelope()
    });
    expect(repository.liveStates.get("room-10")).toEqual(liveStateEnvelope());

    await expect(
      service.record({
        roomCode: "100010",
        ownerId: "owner-1",
        mutationId: mutationIdValue,
        status: "open",
        actions: [
          {
            playerId: "user-1",
            playerKind: "human",
            type: "player_joined",
            payload: { seat: 0 }
          }
        ],
        state: liveStateEnvelope()
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });

    await service.record({
      roomCode: "100010",
      ownerId: "owner-1",
      mutationId: mutationId(14),
      status: "closed",
      actions: [
        {
          playerId: null,
          playerKind: null,
          type: "room_failed",
          payload: { reason: "test" }
        }
      ],
      state: liveStateEnvelope()
    });
    expect(repository.liveStates.has("room-10")).toBe(false);
    expect(repository.skippedClosedStateWrites).toBe(1);

    repository.roomClaims.delete("room-10");
    await expect(
      service.record({
        roomCode: "100010",
        ownerId: "owner-1",
        mutationId: mutationId(14),
        status: "closed",
        actions: [
          {
            playerId: null,
            playerKind: null,
            type: "room_failed",
            payload: { reason: "test" }
          }
        ],
        state: liveStateEnvelope()
      })
    ).resolves.toMatchObject({
      roomEventIds: ["room-event-2"]
    });
  });
});

function liveStateEnvelope() {
  return {
    version: 1 as const,
    table: {
      phase: "waiting" as const,
      players: [],
      currentPlayerId: null,
      landlordId: null,
      bidCandidateId: null,
      firstBidderId: null,
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
    nicknames: { "user-1": "Alice" }
  };
}

function mutationId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function createSettlementPayload(winnerId: string): Record<string, unknown> {
  return {
    settlement: {
      winnerId,
      landlordId: winnerId,
      landlordWon: true,
      baseScore: 1,
      players: [
        { playerId: "p0", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
        { playerId: "p1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
        { playerId: "p2", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
      ]
    }
  };
}
