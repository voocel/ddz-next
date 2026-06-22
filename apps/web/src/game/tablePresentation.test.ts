import { describe, expect, it } from "vitest";
import type { GameEvent, GameSnapshotDto } from "@ddz/protocol";
import { describeEventFeedback, describePhasePrompt, describeSnapshotStatus, formatActor } from "./tablePresentation";

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
    expect(describeEventFeedback(cardPlayedEvent(), "p0")).toBeNull();
    expect(describeEventFeedback({ type: "player_passed", playerId: "bot:room:2", snapshot: snapshot("playing", "p0") }, "p0")).toBe(
      "机器人2 过牌"
    );
    expect(describeEventFeedback({ type: "room_failed", reason: "API 写入失败" }, "p0")).toBe("房间故障: API 写入失败");
    expect(describeEventFeedback({ type: "bot_chat", playerId: "bot:room:1", text: "这把稳了" }, "p0")).toBe("机器人1: 这把稳了");
  });

  it("formats actors compactly", () => {
    expect(formatActor("p0", "p0")).toBe("你");
    expect(formatActor("bot:room:2", "p0")).toBe("机器人2");
    expect(formatActor("long-human-player", "p0")).toBe("long-hum...");
  });

  it("prefers nickname over truncated id and bot fallback", () => {
    expect(formatActor("cuid-of-bob-very-long", "p0", "Bob")).toBe("Bob");
    expect(formatActor("p0", "p0", "Alice")).toBe("你");
    // 机器人现在也带服务端生成的展示名,昵称优先于"机器人N"兜底
    expect(formatActor("bot:room:1", "p0", "AI小七")).toBe("AI小七");
    // 缺昵称时仍兜底为可读的"机器人N"
    expect(formatActor("bot:room:1", "p0")).toBe("机器人1");
  });

  it("uses snapshot nickname in prompts and feedback", () => {
    const withBob: GameSnapshotDto = {
      ...snapshot("playing", "cuid-of-bob-very-long"),
      players: [
        { id: "p0", kind: "human", seat: 0, ready: true, handCount: 17, connected: true, score: 0 },
        { id: "cuid-of-bob-very-long", kind: "human", seat: 1, ready: true, handCount: 17, connected: true, score: 0, nickname: "Bob" },
        { id: "bot:room:2", kind: "bot", seat: 2, ready: true, handCount: 17, connected: true, score: 0 }
      ]
    };

    expect(describePhasePrompt(withBob, "p0")).toBe("等待 Bob 出牌");
    expect(describeEventFeedback({ type: "player_passed", playerId: "cuid-of-bob-very-long", snapshot: withBob }, "p0")).toBe(
      "Bob 过牌"
    );
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
    multiplier: 1,
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
