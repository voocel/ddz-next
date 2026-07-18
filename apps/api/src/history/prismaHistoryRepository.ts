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
      coinDelta: true,
      botProvider: true,
      botModel: true
    }
  }
} as const;

const roundReplaySelect = {
  ...roundHistorySelect,
  actions: {
    orderBy: {
      seq: "asc"
    },
    select: {
      id: true,
      seq: true,
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
    const rounds = (await this.prisma.round.findMany({
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
    })) as RoundHistoryRecord[];
    return this.attachNicknames(rounds);
  }

  async findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null> {
    const round = (await this.prisma.round.findFirst({
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
    })) as RoundReplayRecord | null;
    if (!round) {
      return null;
    }
    const [enriched] = await this.attachNicknames([round]);
    return enriched ?? round;
  }

  async findPublicBotRoundById(roundId: string): Promise<RoundReplayRecord | null> {
    // some bot + none human:排除真人局(保护手牌隐私)与尚无结算行的进行中局
    return (await this.prisma.round.findFirst({
      where: {
        id: roundId,
        endedAt: { not: null },
        players: {
          some: { playerKind: "bot" },
          none: { playerKind: "human" }
        }
      },
      select: roundReplaySelect
    })) as RoundReplayRecord | null;
  }

  async listRecentBotRounds(limit: number): Promise<readonly RoundHistoryRecord[]> {
    return (await this.prisma.round.findMany({
      where: {
        endedAt: { not: null },
        // 流局无对局内容,不进公开复盘列表
        abortReason: null,
        players: {
          some: { playerKind: "bot" },
          none: { playerKind: "human" }
        }
      },
      orderBy: {
        endedAt: "desc"
      },
      take: limit,
      select: roundHistorySelect
    })) as RoundHistoryRecord[];
  }

  /** RoundPlayer.playerId 对真人即 User.id（bot 为 "bot:N" 无对应用户），批量回填昵称 */
  private async attachNicknames<T extends RoundHistoryRecord>(rounds: T[]): Promise<T[]> {
    const humanIds = [
      ...new Set(
        rounds.flatMap((round) =>
          round.players.filter((player) => player.playerKind === "human").map((player) => player.playerId)
        )
      )
    ];
    if (!humanIds.length) {
      return rounds;
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: humanIds
        }
      },
      select: {
        id: true,
        nickname: true
      }
    });
    const nicknames = new Map(users.map((user) => [user.id, user.nickname]));
    return rounds.map((round) => ({
      ...round,
      players: round.players.map((player) => {
        const nickname = nicknames.get(player.playerId);
        return nickname === undefined ? player : { ...player, nickname };
      })
    }));
  }

  async listCoinLedgersByUserId(userId: string, limit: number): Promise<readonly CoinLedgerRecord[]> {
    const ledgers = await this.prisma.coinLedger.findMany({
      where: {
        userId
      },
      // createdAt 相同时以 id 作次键，保证排序确定性
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
