import type { Prisma, PrismaClient } from "@prisma/client";
import type { RoomLiveStateEnvelope } from "@ddz/protocol";
import { GameActionError } from "./errors.js";
import type {
  GameActionMutationRecord,
  GameActionRecord,
  GameActionRepository,
  RoomEventInput,
  RoomEventRecord,
  RoundActionInput,
  RoundRecord,
  RoundSettlementInput
} from "./service.js";

const roundSelect = {
  id: true,
  roomId: true,
  endedAt: true
} as const;

const roomEventSelect = {
  id: true,
  roomId: true,
  playerId: true,
  playerKind: true,
  type: true,
  payload: true,
  createdAt: true
} as const;

const gameActionSelect = {
  id: true,
  roundId: true,
  playerId: true,
  playerKind: true,
  type: true,
  payload: true,
  createdAt: true
} as const;

type PrismaTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const mutationSelect = {
  mutationId: true,
  actionFingerprint: true,
  roomEventIds: true,
  actionIds: true,
  roundId: true
} as const;

export class PrismaGameActionRepository implements GameActionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findRoomIdByCode(code: string): Promise<string | null> {
    const room = await this.prisma.room.findUnique({
      where: {
        code
      },
      select: {
        id: true
      }
    });

    return room?.id ?? null;
  }

  async findOpenRoundByRoomId(roomId: string): Promise<RoundRecord | null> {
    return this.prisma.round.findFirst({
      where: {
        roomId,
        endedAt: null
      },
      orderBy: {
        startedAt: "desc"
      },
      select: roundSelect
    });
  }

  async findMutation(roomId: string, mutationId: string): Promise<GameActionMutationRecord | null> {
    const mutation = await this.prisma.gameActionMutation.findUnique({
      where: {
        roomId_mutationId: {
          roomId,
          mutationId
        }
      },
      select: mutationSelect
    });

    return mutation ? toMutationRecord(mutation) : null;
  }

  async recordBatch(input: {
    roomId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
    state: RoomLiveStateEnvelope | null;
  }): Promise<GameActionMutationRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
      const existingMutation = await tx.gameActionMutation.findUnique({
        where: {
          roomId_mutationId: {
            roomId: input.roomId,
            mutationId: input.mutationId
          }
        },
        select: mutationSelect
      });
      if (existingMutation) {
        return toMutationRecord(assertSameMutation(existingMutation, input.actionFingerprint));
      }

      const roomEvents: RoomEventRecord[] = [];
      const actions: GameActionRecord[] = [];
      let round = await findOpenRound(tx, input.roomId);

      for (const event of input.roomEvents) {
        roomEvents.push(await createRoomEvent(tx, input.roomId, event));
      }

      for (const action of input.roundActions) {
        if (action.type === "round_started") {
          // 事务内重查，确保同一房间不存在未结束的局（DB 部分唯一索引兜底）
          const openRound = await findOpenRound(tx, input.roomId);
          if (openRound) {
            throw new GameActionError("Cannot start a round while another round is open.", 409);
          }
          round = await tx.round.create({
            data: {
              roomId: input.roomId
            },
            select: roundSelect
          });
        }

        if (!round) {
          throw new GameActionError(`Cannot record ${action.type} without an open round.`, 409);
        }

        const created = await tx.gameAction.create({
          data: {
            roundId: round.id,
            playerId: action.playerId,
            playerKind: action.playerKind,
            type: action.type,
            payload: action.payload as Prisma.InputJsonValue
          },
          select: gameActionSelect
        });
        actions.push(created as GameActionRecord);

        if (action.settlement) {
          await applySettlement(tx, round.id, action.settlement);
          round = {
            ...round,
            endedAt: new Date()
          };
        }
      }

      const mutation = await tx.gameActionMutation.create({
        data: {
          roomId: input.roomId,
          mutationId: input.mutationId,
          actionFingerprint: input.actionFingerprint,
          roomEventIds: roomEvents.map((event) => event.id),
          actionIds: actions.map((action) => action.id),
          roundId: round?.id ?? null
        },
        select: mutationSelect
      });

      if (input.state) {
        // dispose 竞态守卫：房间已 closed 时不再写恢复状态（关房流程已删行）
        const room = await tx.room.findUnique({
          where: { id: input.roomId },
          select: { status: true }
        });
        if (room && room.status !== "closed") {
          await tx.roomLiveState.upsert({
            where: { roomId: input.roomId },
            update: { state: input.state as unknown as Prisma.InputJsonValue },
            create: { roomId: input.roomId, state: input.state as unknown as Prisma.InputJsonValue }
          });
        }
      }

      return toMutationRecord(mutation);
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await this.findMutation(input.roomId, input.mutationId);
      if (!existing) {
        throw error;
      }
      return assertSameMutation(existing, input.actionFingerprint);
    }
  }
}

function toMutationRecord(mutation: {
  readonly mutationId: string;
  readonly actionFingerprint: string;
  readonly roomEventIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly roundId: string | null;
}): GameActionMutationRecord {
  return {
    mutationId: mutation.mutationId,
    actionFingerprint: mutation.actionFingerprint,
    roomEventIds: mutation.roomEventIds,
    actionIds: mutation.actionIds,
    roundId: mutation.roundId
  };
}

function assertSameMutation<T extends { readonly actionFingerprint: string }>(mutation: T, actionFingerprint: string): T {
  if (mutation.actionFingerprint !== actionFingerprint) {
    throw new GameActionError("Mutation id was already used for different game actions.", 409);
  }
  return mutation;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function findOpenRound(tx: PrismaTransaction, roomId: string): Promise<RoundRecord | null> {
  return tx.round.findFirst({
    where: {
      roomId,
      endedAt: null
    },
    orderBy: {
      startedAt: "desc"
    },
    select: roundSelect
  });
}

async function createRoomEvent(tx: PrismaTransaction, roomId: string, event: RoomEventInput): Promise<RoomEventRecord> {
  const created = await tx.roomEvent.create({
    data: {
      roomId,
      playerId: event.playerId,
      playerKind: event.playerKind,
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue
    },
    select: roomEventSelect
  });
  return created as RoomEventRecord;
}

async function applySettlement(tx: PrismaTransaction, roundId: string, settlement: RoundSettlementInput): Promise<void> {
  // 带 endedAt 守卫的条件更新：已结算的局不能二次结算
  const settled = await tx.round.updateMany({
    where: {
      id: roundId,
      endedAt: null
    },
    data: {
      landlordId: settlement.landlordId,
      endedAt: new Date()
    }
  });
  if (settled.count === 0) {
    throw new GameActionError("Round was already settled.", 409);
  }

  // 按 playerId 排序后逐个更新，保证并发事务以相同顺序加锁，避免死锁
  const players = [...settlement.players].sort((a, b) => a.playerId.localeCompare(b.playerId));
  for (const player of players) {
    await tx.roundPlayer.upsert({
      where: {
        roundId_playerId: {
          roundId,
          playerId: player.playerId
        }
      },
      update: {
        playerKind: player.playerKind,
        seat: player.seat,
        score: player.scoreDelta,
        coinDelta: player.scoreDelta
      },
      create: {
        roundId,
        playerId: player.playerId,
        playerKind: player.playerKind,
        seat: player.seat,
        score: player.scoreDelta,
        coinDelta: player.scoreDelta
      }
    });

    if (player.playerKind === "human") {
      const user = await tx.user.update({
        where: {
          id: player.playerId
        },
        data: {
          coin: {
            increment: player.scoreDelta
          }
        },
        select: {
          coin: true
        }
      });

      await tx.coinLedger.create({
        data: {
          userId: player.playerId,
          roundId,
          delta: player.scoreDelta,
          balance: user.coin,
          reason: "round_settled"
        }
      });
    }
  }
}
