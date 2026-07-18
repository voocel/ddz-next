import type { LeaderboardEntryDto, LeaderboardResponse } from "@ddz/protocol";

export interface LeaderboardRepository {
  /** 按 (botProvider, botModel) 聚合全部已结束对局(含流局的技术负计数),无序返回 */
  aggregateByModel(): Promise<readonly LeaderboardEntryDto[]>;
}

export class LeaderboardService {
  constructor(private readonly leaderboard: LeaderboardRepository) {}

  /** 模型排行榜:胜率降序,同率按局数(样本量大者靠前),再按累计分 */
  async getLeaderboard(): Promise<LeaderboardResponse> {
    const entries = await this.leaderboard.aggregateByModel();
    return {
      entries: [...entries].sort((left, right) => {
        const leftRate = left.games ? left.wins / left.games : 0;
        const rightRate = right.games ? right.wins / right.games : 0;
        return rightRate - leftRate || right.games - left.games || right.totalScore - left.totalScore;
      })
    };
  }
}
