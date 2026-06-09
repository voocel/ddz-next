import { describe, expect, it } from "vitest";
import type { GameEvent, GameSnapshotDto } from "@ddz/protocol";
import { describeEventFeedback, describePhasePrompt, describeSettlement, describeSnapshotStatus, formatActor } from "./tablePresentation";

describe("table presentation", () => {
  it("describes status with localized phase and local actor", () => {
    const status = describeSnapshotStatus(snapshot("playing", "p0"), "p0");

    expect(status).toContain("阶段: 出牌阶段");
    expect(status).toContain("当前: 你");
  });

  it("describes phase prompts from the local player's perspective", () => {
    expect(describePhasePrompt(snapshot("bidding", "p0"), "p0")).toBe("轮到你叫地主");
    expect(describePhasePrompt(snapshot("robbing", "bot:room:1"), "p0")).toBe("等待 机器人1 抢地主");
  });

  it("describes game events for action feedback", () => {
    expect(describeEventFeedback(cardPlayedEvent(), "p0")).toBe("你 出牌 单牌");
    expect(describeEventFeedback({ type: "player_passed", playerId: "bot:room:2", snapshot: snapshot("playing", "p0") }, "p0")).toBe(
      "机器人2 过牌"
    );
    expect(describeEventFeedback({ type: "room_failed", reason: "API 写入失败" }, "p0")).toBe("房间故障: API 写入失败");
  });

  it("formats actors compactly", () => {
    expect(formatActor("p0", "p0")).toBe("你");
    expect(formatActor("bot:room:2", "p0")).toBe("机器人2");
    expect(formatActor("long-human-player", "p0")).toBe("long-hum...");
  });

  it("describes settlement rows in seat order", () => {
    expect(describeSettlement(settledSnapshot(), "p0")).toEqual([
      "赢家 你",
      "地主 你",
      "你  地主  +2  总分 2",
      "机器人1  农民  -1  总分 -1",
      "机器人2  农民  -1  总分 -1"
    ]);
  });
});

function snapshot(phase: GameSnapshotDto["phase"], currentPlayerId: string | null): GameSnapshotDto {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: true, handCount: 17, connected: true, score: 0 },
      { id: "bot:room:1", kind: "bot", seat: 1, ready: true, handCount: 17, connected: true, score: 0 },
      { id: "bot:room:2", kind: "bot", seat: 2, ready: true, handCount: 17, connected: true, score: 0 }
    ],
    currentPlayerId,
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    settlement: null
  };
}

function cardPlayedEvent(): GameEvent {
  const card = {
    id: "3-clubs",
    rank: "3",
    suit: "clubs"
  } as const;

  return {
    type: "cards_played",
    play: {
      playerId: "p0",
      cards: [card],
      combination: {
        kind: "single",
        cards: [card],
        mainRank: "3",
        length: 1
      }
    },
    snapshot: snapshot("playing", "bot:room:1"),
    hand: []
  };
}

function settledSnapshot(): GameSnapshotDto {
  return {
    ...snapshot("settled", null),
    landlordId: "p0",
    settlement: {
      winnerId: "p0",
      landlordId: "p0",
      landlordWon: true,
      baseScore: 1,
      players: [
        { playerId: "bot:room:2", seat: 2, role: "farmer", handCount: 8, scoreDelta: -1, totalScore: -1 },
        { playerId: "p0", seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
        { playerId: "bot:room:1", seat: 1, role: "farmer", handCount: 5, scoreDelta: -1, totalScore: -1 }
      ]
    }
  };
}
