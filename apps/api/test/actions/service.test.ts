import { describe, expect, it } from "vitest";
import {
  GameActionService,
  type GameActionMutationRecord,
  type GameActionRecord,
  type GameActionRepository,
  type RoomEventInput,
  type RoomEventRecord,
  type RoundActionInput,
  type RoundRecord
} from "../../src/actions/service";
import type { RoomActionType, RoundActionType } from "@ddz/protocol";

describe("GameActionService", () => {
  it("records room events without creating a round", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.rooms.set("ROOM01", "room-1");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "ROOM01",
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
    repository.rooms.set("ROOM05", "room-5");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "ROOM05",
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

  it("rejects missing rooms", async () => {
    const service = new GameActionService(new InMemoryGameActionRepository());

    await expect(
      service.record({
        roomCode: "ROOM01",
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
    repository.rooms.set("ROOM02", "room-2");
    await repository.seedRound("room-2");
    const service = new GameActionService(repository);

    const recorded = await service.record({
      roomCode: "ROOM02",
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
    repository.rooms.set("ROOM06", "room-6");
    await repository.seedRound("room-6");
    const service = new GameActionService(repository);
    const input = {
      roomCode: "ROOM06",
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
    repository.rooms.set("ROOM07", "room-7");
    const service = new GameActionService(repository);
    const reusedMutationId = mutationId(6);

    await service.record({
      roomCode: "ROOM07",
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
        roomCode: "ROOM07",
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
    repository.rooms.set("ROOM04", "room-4");
    await repository.seedRound("room-4");
    const service = new GameActionService(repository);

    await service.record({
      roomCode: "ROOM04",
      mutationId: mutationId(7),
      actions: [
        {
          playerId: "bot:ROOM04:1",
          playerKind: "bot",
          type: "round_settled",
          payload: {
            settlement: {
              winnerId: "bot:ROOM04:1",
              landlordId: "bot:ROOM04:1",
              landlordWon: true,
              baseScore: 1,
              players: [
                { playerId: "bot:ROOM04:1", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
                { playerId: "p1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
                { playerId: "bot:ROOM04:2", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
              ]
            }
          }
        }
      ]
    });

    expect(repository.settlements[0]?.players).toEqual([
      { playerId: "bot:ROOM04:1", playerKind: "bot", seat: 0, scoreDelta: 2 },
      { playerId: "p1", playerKind: "human", seat: 1, scoreDelta: -1 },
      { playerId: "bot:ROOM04:2", playerKind: "bot", seat: 2, scoreDelta: -1 }
    ]);
    expect(repository.coinLedgerPlayerIds).toEqual(["p1"]);
  });

  it("rejects round actions without an open round", async () => {
    const repository = new InMemoryGameActionRepository();
    repository.rooms.set("ROOM03", "room-3");
    const service = new GameActionService(repository);

    await expect(
      service.record({
        roomCode: "ROOM03",
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
});

export class InMemoryGameActionRepository implements GameActionRepository {
  readonly rooms = new Map<string, string>();
  readonly rounds: RoundRecord[] = [];
  readonly roomEvents: RoomEventRecord[] = [];
  readonly actions: GameActionRecord[] = [];
  readonly mutations = new Map<string, GameActionMutationRecord>();
  readonly settlements: Array<{
    roundId: string;
    landlordId: string;
    players: Array<{ playerId: string; playerKind: "human" | "bot"; seat: number; scoreDelta: number }>;
  }> = [];
  readonly coinLedgerPlayerIds: string[] = [];

  async findRoomIdByCode(code: string): Promise<string | null> {
    return this.rooms.get(code) ?? null;
  }

  async findOpenRoundByRoomId(roomId: string): Promise<RoundRecord | null> {
    return this.rounds.find((round) => round.roomId === roomId && !round.endedAt) ?? null;
  }

  async findMutation(roomId: string, mutationId: string): Promise<GameActionMutationRecord | null> {
    return this.mutations.get(mutationKey(roomId, mutationId)) ?? null;
  }

  async seedRound(roomId: string): Promise<RoundRecord> {
    const round = {
      id: `round-${this.rounds.length + 1}`,
      roomId,
      endedAt: null
    };
    this.rounds.push(round);
    return round;
  }

  async recordBatch(input: {
    roomId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
  }): Promise<GameActionMutationRecord> {
    const existingMutation = await this.findMutation(input.roomId, input.mutationId);
    if (existingMutation) {
      return existingMutation;
    }

    const roomEvents = input.roomEvents.map((event) => this.createRoomEvent(input.roomId, event));
    const actions: GameActionRecord[] = [];
    let round = await this.findOpenRoundByRoomId(input.roomId);

    for (const action of input.roundActions) {
      if (action.type === "round_started") {
        round = await this.seedRound(input.roomId);
      }
      if (!round) {
        throw new Error(`Cannot record ${action.type} without an open round.`);
      }
      actions.push(this.createAction(round.id, action));
      if (action.settlement) {
        this.settlements.push({
          roundId: round.id,
          landlordId: action.settlement.landlordId,
          players: action.settlement.players.map((player) => ({ ...player }))
        });
        this.coinLedgerPlayerIds.push(
          ...action.settlement.players.filter((player) => player.playerKind === "human").map((player) => player.playerId)
        );
        round = {
          ...round,
          endedAt: new Date(Date.UTC(2026, 0, this.actions.length + 1))
        };
        const index = this.rounds.findIndex((item) => item.id === round?.id);
        if (index >= 0) {
          this.rounds[index] = round;
        }
      }
    }

    const mutation = {
      mutationId: input.mutationId,
      actionFingerprint: input.actionFingerprint,
      roomEventIds: roomEvents.map((event) => event.id),
      actionIds: actions.map((action) => action.id),
      roundId: round?.id ?? null
    };
    this.mutations.set(mutationKey(input.roomId, input.mutationId), mutation);
    return mutation;
  }

  private createRoomEvent(roomId: string, input: RoomEventInput): RoomEventRecord {
    const event = {
      id: `room-event-${this.roomEvents.length + 1}`,
      roomId,
      playerId: input.playerId,
      playerKind: input.playerKind,
      type: input.type as RoomActionType,
      payload: input.payload,
      createdAt: new Date(Date.UTC(2026, 0, this.roomEvents.length + 1))
    };
    this.roomEvents.push(event);
    return event;
  }

  private createAction(roundId: string, input: RoundActionInput): GameActionRecord {
    const action = {
      id: `action-${this.actions.length + 1}`,
      roundId,
      playerId: input.playerId,
      playerKind: input.playerKind,
      type: input.type as RoundActionType,
      payload: input.payload,
      createdAt: new Date(Date.UTC(2026, 0, this.actions.length + 1))
    };
    this.actions.push(action);
    return action;
  }
}

function mutationId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function mutationKey(roomId: string, mutationIdValue: string): string {
  return `${roomId}:${mutationIdValue}`;
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
