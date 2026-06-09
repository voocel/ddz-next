import type { PrismaClient } from "@prisma/client";
import type { CoinLedgerRecord, HistoryRepository, RoundHistoryRecord, RoundReplayRecord } from "./service.js";

const roundHistorySelect = {
  id: true,
  room: {
    select: {
      code: true
    }
  },
  landlordId: true,
  startedAt: true,
  endedAt: true,
  players: {
    orderBy: {
      seat: "asc"
    },
    select: {
      playerId: true,
      playerKind: true,
      seat: true,
      score: true,
      coinDelta: true
    }
  }
} as const;

const roundReplaySelect = {
  ...roundHistorySelect,
  actions: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      type: true,
      playerId: true,
      playerKind: true,
      payload: true,
      createdAt: true
    }
  }
} as const;

export class PrismaHistoryRepository implements HistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listRoundsByUserId(userId: string, limit: number): Promise<readonly RoundHistoryRecord[]> {
    return this.prisma.round.findMany({
      where: {
        players: {
          some: {
            playerId: userId,
            playerKind: "human"
          }
        }
      },
      orderBy: {
        startedAt: "desc"
      },
      take: limit,
      select: roundHistorySelect
    }) as Promise<RoundHistoryRecord[]>;
  }

  async findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null> {
    return this.prisma.round.findFirst({
      where: {
        id: roundId,
        players: {
          some: {
            playerId: userId,
            playerKind: "human"
          }
        }
      },
      select: roundReplaySelect
    }) as Promise<RoundReplayRecord | null>;
  }

  async listCoinLedgersByUserId(userId: string, limit: number): Promise<readonly CoinLedgerRecord[]> {
    const ledgers = await this.prisma.coinLedger.findMany({
      where: {
        userId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      select: {
        id: true,
        roundId: true,
        delta: true,
        balance: true,
        reason: true,
        createdAt: true,
        round: {
          select: {
            room: {
              select: {
                code: true
              }
            }
          }
        }
      }
    });

    return ledgers.map((ledger) => ({
      id: ledger.id,
      roundId: ledger.roundId,
      roomCode: ledger.round.room.code,
      delta: ledger.delta,
      balance: ledger.balance,
      reason: ledger.reason,
      createdAt: ledger.createdAt
    }));
  }
}
