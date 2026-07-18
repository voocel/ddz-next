import { describe, expect, it } from "vitest";
import { HistoryService } from "../../src/history/service";
import { HistoryError } from "../../src/history/errors";
import { InMemoryHistoryRepository } from "../helpers";
import type { RoundReplayRecord } from "../../src/history/service";

const startedAt = new Date("2026-07-17T00:00:00Z");
const endedAt = new Date("2026-07-17T00:05:00Z");

function botRound(overrides: Partial<RoundReplayRecord> = {}): RoundReplayRecord {
  return {
    id: "round-1",
    room: { code: "100001" },
    landlordId: "bot:a",
    startedAt,
    endedAt,
    players: [
      { playerId: "bot:a", playerKind: "bot", seat: 0, score: 4, coinDelta: 4, botProvider: "anthropic", botModel: "model-a" },
      { playerId: "bot:b", playerKind: "bot", seat: 1, score: -2, coinDelta: -2, botProvider: "openai", botModel: "model-b" },
      { playerId: "bot:c", playerKind: "bot", seat: 2, score: -2, coinDelta: -2, botProvider: "google", botModel: "model-c" }
    ],
    actions: [
      {
        id: "action-1",
        seq: 1,
        type: "round_started",
        playerId: null,
        playerKind: null,
        payload: {
          initialHands: {
            "bot:a": ["3-hearts", "SJ"],
            "bot:b": ["4-spades"],
            "bot:c": ["BJ"]
          }
        },
        createdAt: startedAt
      }
    ],
    ...overrides
  };
}

describe("HistoryService public replays", () => {
  it("公开复盘:全 bot 局明牌下发 revealedHands,选手带模型身份,viewerInitialHand 恒为空", async () => {
    const repository = new InMemoryHistoryRepository();
    repository.publicReplays.set("round-1", botRound());
    const service = new HistoryService(repository);

    const response = await service.getPublicRoundReplay("round-1");

    expect(response.round.viewerInitialHand).toEqual([]);
    expect(response.round.revealedHands).toEqual([
      { playerId: "bot:a", cards: [{ id: "3-hearts", rank: "3", suit: "hearts" }, { id: "SJ", rank: "SJ" }] },
      { playerId: "bot:b", cards: [{ id: "4-spades", rank: "4", suit: "spades" }] },
      { playerId: "bot:c", cards: [{ id: "BJ", rank: "BJ" }] }
    ]);
    expect(response.round.players.map((player) => player.model?.model)).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("带真人的局公开通道视为不存在(404),保护真人手牌", async () => {
    const repository = new InMemoryHistoryRepository();
    repository.publicReplays.set(
      "round-2",
      botRound({
        id: "round-2",
        players: [
          { playerId: "user-1", playerKind: "human", seat: 0, score: 4, coinDelta: 4 },
          { playerId: "bot:b", playerKind: "bot", seat: 1, score: -2, coinDelta: -2 },
          { playerId: "bot:c", playerKind: "bot", seat: 2, score: -2, coinDelta: -2 }
        ]
      })
    );
    const service = new HistoryService(repository);

    await expect(service.getPublicRoundReplay("round-2")).rejects.toThrow(HistoryError);
  });

  it("最近公开对局列表按结束时间倒序", async () => {
    const repository = new InMemoryHistoryRepository();
    repository.publicReplays.set("round-1", botRound());
    repository.publicReplays.set(
      "round-3",
      botRound({ id: "round-3", endedAt: new Date("2026-07-17T01:00:00Z") })
    );
    const service = new HistoryService(repository);

    const response = await service.listRecentBotReplays();

    expect(response.rounds.map((round) => round.id)).toEqual(["round-3", "round-1"]);
  });
});
