import { describe, expect, it } from "vitest";
import { LeaderboardService } from "../../src/leaderboard/service";
import { InMemoryLeaderboardRepository, type LeaderboardSeedRow } from "../helpers";

const endedAt = new Date("2026-07-17T00:00:00Z");

function seedRow(overrides: Partial<LeaderboardSeedRow>): LeaderboardSeedRow {
  return {
    playerId: "bot:x",
    score: 0,
    botProvider: "anthropic",
    botModel: "model-a",
    landlordId: null,
    abortReason: null,
    failedPlayerId: null,
    endedAt,
    ...overrides
  };
}

describe("LeaderboardService", () => {
  it("按模型聚合:地主/农民分列,真人行与未结束局不计,流局只记技术负", async () => {
    const repository = new InMemoryLeaderboardRepository();
    repository.rows.push(
      // model-a: 地主赢 +4、农民输 -1 → 2 局 1 胜,地主 1/1,农民 0/1
      seedRow({ playerId: "bot:a", score: 4, landlordId: "bot:a" }),
      seedRow({ playerId: "bot:a", score: -1, landlordId: "bot:other" }),
      // model-a 的流局技术负:不计 games,只记 technicalLosses
      seedRow({ playerId: "bot:a", score: 0, abortReason: "bot_decision_failed", failedPlayerId: "bot:a" }),
      // model-b: 农民赢 +2 → 1 局 1 胜
      seedRow({ playerId: "bot:b", botModel: "model-b", score: 2, landlordId: "bot:other" }),
      // 真人行(无模型身份)与未结束局都不进榜
      seedRow({ playerId: "human", botProvider: null, botModel: null, score: 4 }),
      seedRow({ playerId: "bot:a", score: 4, endedAt: null })
    );
    const service = new LeaderboardService(repository);

    const response = await service.getLeaderboard();

    // model-b 胜率 100% 排前,model-a 50% 在后
    expect(response.entries.map((entry) => entry.model)).toEqual(["model-b", "model-a"]);
    const modelA = response.entries.find((entry) => entry.model === "model-a")!;
    expect(modelA).toEqual({
      provider: "anthropic",
      model: "model-a",
      games: 2,
      wins: 1,
      landlordGames: 1,
      landlordWins: 1,
      farmerGames: 1,
      farmerWins: 0,
      totalScore: 3,
      technicalLosses: 1
    });
  });

  it("同胜率按局数排序(样本量大者靠前)", async () => {
    const repository = new InMemoryLeaderboardRepository();
    repository.rows.push(
      seedRow({ playerId: "bot:a", score: 2, landlordId: "bot:other" }),
      seedRow({ playerId: "bot:a", score: 2, landlordId: "bot:other" }),
      seedRow({ playerId: "bot:a", score: -2, landlordId: "bot:other" }),
      seedRow({ playerId: "bot:a", score: -2, landlordId: "bot:other" }),
      seedRow({ playerId: "bot:b", botModel: "model-b", score: 2, landlordId: "bot:other" }),
      seedRow({ playerId: "bot:b", botModel: "model-b", score: -2, landlordId: "bot:other" })
    );
    const service = new LeaderboardService(repository);

    const response = await service.getLeaderboard();

    expect(response.entries.map((entry) => [entry.model, entry.games])).toEqual([
      ["model-a", 4],
      ["model-b", 2]
    ]);
  });
});
