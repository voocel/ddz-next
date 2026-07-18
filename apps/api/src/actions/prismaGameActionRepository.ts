import type { Prisma, PrismaClient } from "@prisma/client";
import type { RoomLiveStateEnvelope, RoomStatus } from "@ddz/protocol";
import { GameActionError } from "./errors.js";
import { assertRoomStatusTransition } from "../rooms/status.js";
import type {
  GameActionMutationRecord,
  GameActionRecord,
  GameActionRepository,
  RoomEventInput,
  RoomEventRecord,
  RoundAbortInput,
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
  seq: true,
  playerId: true,
  playerKind: true,
  type: true,
  payload: true,
  createdAt: true
} as const;

const gameActionSelect = {
  id: true,
  roundId: true,
  seq: true,
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
    ownerId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
    status: RoomStatus | null;
    state: RoomLiveStateEnvelope | null;
  }): Promise<GameActionMutationRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockRoom(tx, input.roomId);
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
        await assertRoomClaimOwner(tx, input.roomId, input.ownerId);

        const roomEvents: RoomEventRecord[] = [];
        const actions: GameActionRecord[] = [];
        let round = await findOpenRound(tx, input.roomId);
        let nextRoomEventSeq = await nextRoomEventSequence(tx, input.roomId);
        const roundSeqs = new Map<string, number>();

        for (const event of input.roomEvents) {
          roomEvents.push(await createRoomEvent(tx, input.roomId, nextRoomEventSeq, event));
          nextRoomEventSeq += 1;
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

          let nextActionSeq = roundSeqs.get(round.id);
          if (nextActionSeq === undefined) {
            nextActionSeq = await nextGameActionSequence(tx, round.id);
          }
          const created = await tx.gameAction.create({
            data: {
              roundId: round.id,
              seq: nextActionSeq,
              playerId: action.playerId,
              playerKind: action.playerKind,
              type: action.type,
              payload: action.payload as Prisma.InputJsonValue
            },
            select: gameActionSelect
          });
          actions.push(created as GameActionRecord);
          roundSeqs.set(round.id, nextActionSeq + 1);

          if (action.settlement) {
            await applySettlement(tx, round.id, action.settlement);
            round = {
              ...round,
              endedAt: new Date()
            };
          }

          if (action.abort) {
            await applyAbort(tx, round.id, action.abort);
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

        if (input.state && input.status !== "closed") {
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

        if (input.status) {
          await updateRoomStatus(tx, input.roomId, input.status);
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

async function lockRoom(tx: PrismaTransaction, roomId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id"
    FROM "Room"
    WHERE "id" = ${roomId}
    FOR UPDATE
  `;
}

async function assertRoomClaimOwner(tx: PrismaTransaction, roomId: string, ownerId: string): Promise<void> {
  const claim = await tx.roomClaim.findUnique({
    where: { roomId },
    select: { ownerId: true }
  });
  if (claim?.ownerId !== ownerId) {
    throw new GameActionError("Room claim is not held by this game server.", 409);
  }
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

async function nextRoomEventSequence(tx: PrismaTransaction, roomId: string): Promise<number> {
  const last = await tx.roomEvent.findFirst({
    where: { roomId },
    orderBy: { seq: "desc" },
    select: { seq: true }
  });
  return (last?.seq ?? 0) + 1;
}

async function nextGameActionSequence(tx: PrismaTransaction, roundId: string): Promise<number> {
  const last = await tx.gameAction.findFirst({
    where: { roundId },
    orderBy: { seq: "desc" },
    select: { seq: true }
  });
  return (last?.seq ?? 0) + 1;
}

async function createRoomEvent(
  tx: PrismaTransaction,
  roomId: string,
  seq: number,
  event: RoomEventInput
): Promise<RoomEventRecord> {
  const created = await tx.roomEvent.create({
    data: {
      roomId,
      seq,
      playerId: event.playerId,
      playerKind: event.playerKind,
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue
    },
    select: roomEventSelect
  });
  return created as RoomEventRecord;
}

async function updateRoomStatus(tx: PrismaTransaction, roomId: string, status: RoomStatus): Promise<void> {
  const current = await tx.room.findUnique({
    where: { id: roomId },
    select: { status: true }
  });
  if (!current) {
    throw new GameActionError("Room not found.", 404);
  }
  assertRoomStatusTransition(current.status as RoomStatus, status);

  await tx.room.update({
    where: { id: roomId },
    data: { status }
  });
  if (status === "closed") {
    await tx.roomLiveState.deleteMany({ where: { roomId } });
    await tx.roomClaim.deleteMany({ where: { roomId } });
  }
}

/**
 * 流局:带 endedAt 守卫关闭 Round(记 abortReason/failedPlayerId),写零分 RoundPlayer 行保留模型身份
 * (供排行把技术负关联到具体模型)。不产生结算、不动金币——事故与牌局结果分离,统计层定责。
 */
async function applyAbort(tx: PrismaTransaction, roundId: string, abort: RoundAbortInput): Promise<void> {
  const aborted = await tx.round.updateMany({
    where: {
      id: roundId,
      endedAt: null
    },
    data: {
      endedAt: new Date(),
      abortReason: abort.reason,
      failedPlayerId: abort.failedPlayerId
    }
  });
  if (aborted.count === 0) {
    throw new GameActionError("Round was already settled.", 409);
  }

  // 与 applySettlement 同款排序,保证并发事务以相同顺序加锁
  const players = [...abort.players].sort((a, b) => a.playerId.localeCompare(b.playerId));
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
        botProvider: player.botProvider,
        botModel: player.botModel
      },
      create: {
        roundId,
        playerId: player.playerId,
        playerKind: player.playerKind,
        seat: player.seat,
        score: 0,
        coinDelta: 0,
        botProvider: player.botProvider,
        botModel: player.botModel
      }
    });
  }
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
        coinDelta: player.scoreDelta,
        botProvider: player.botProvider,
        botModel: player.botModel
      },
      create: {
        roundId,
        playerId: player.playerId,
        playerKind: player.playerKind,
        seat: player.seat,
        score: player.scoreDelta,
        coinDelta: player.scoreDelta,
        botProvider: player.botProvider,
        botModel: player.botModel
      }
    });

    if (player.playerKind === "human") {
      // 脏/已删除的 userId 不应让整批结算事务回滚：跳过其入账，RoundPlayer 已保留、其余玩家照常结算
      const exists = await tx.user.findUnique({
        where: {
          id: player.playerId
        },
        select: {
          id: true
        }
      });

      if (exists) {
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
}
