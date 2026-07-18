import type { PrismaClient } from "@prisma/client";
import type { LeaderboardEntryDto } from "@ddz/protocol";
import type { LeaderboardRepository } from "./service.js";

interface AggregateRow {
  readonly provider: string;
  readonly model: string;
  readonly games: number;
  readonly wins: number;
  readonly landlordGames: number;
  readonly landlordWins: number;
  readonly totalScore: number;
  readonly technicalLosses: number;
}

export class PrismaLeaderboardRepository implements LeaderboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async aggregateByModel(): Promise<readonly LeaderboardEntryDto[]> {
    // 胜负判定:结算零和且底分×倍数≥1,score 恒非 0,score>0 即赢;
    // 流局行 score=0 且 Round.abortReason 非空,不计 games,只按 failedPlayerId 记技术负。
    const rows = await this.prisma.$queryRaw<AggregateRow[]>`
      SELECT
        rp."botProvider"                                                                        AS "provider",
        rp."botModel"                                                                           AS "model",
        COUNT(*) FILTER (WHERE r."abortReason" IS NULL)::int                                    AS "games",
        COUNT(*) FILTER (WHERE rp."score" > 0)::int                                             AS "wins",
        COUNT(*) FILTER (WHERE r."abortReason" IS NULL AND r."landlordId" = rp."playerId")::int AS "landlordGames",
        COUNT(*) FILTER (WHERE rp."score" > 0 AND r."landlordId" = rp."playerId")::int          AS "landlordWins",
        COALESCE(SUM(rp."score"), 0)::int                                                       AS "totalScore",
        COUNT(*) FILTER (WHERE r."failedPlayerId" = rp."playerId")::int                         AS "technicalLosses"
      FROM "RoundPlayer" rp
      JOIN "Round" r ON r."id" = rp."roundId"
      WHERE rp."botProvider" IS NOT NULL
        AND rp."botModel" IS NOT NULL
        AND r."endedAt" IS NOT NULL
      GROUP BY rp."botProvider", rp."botModel"
    `;

    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      games: row.games,
      wins: row.wins,
      landlordGames: row.landlordGames,
      landlordWins: row.landlordWins,
      farmerGames: row.games - row.landlordGames,
      farmerWins: row.wins - row.landlordWins,
      totalScore: row.totalScore,
      technicalLosses: row.technicalLosses
    }));
  }
}
