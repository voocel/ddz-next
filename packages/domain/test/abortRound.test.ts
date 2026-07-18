import { describe, expect, it } from "vitest";
import { GameTable, mulberry32 } from "../src";

function biddingTable(): GameTable {
  const table = new GameTable(mulberry32(7));
  table.addPlayer("a");
  table.addPlayer("b");
  table.addPlayer("c");
  table.setReady("a");
  table.setReady("b");
  table.setReady("c");
  return table;
}

/** 带累计分的进行中牌局(手牌极简),验证流局只清牌局状态不动分。 */
function playingTableWithScores(): GameTable {
  const table = new GameTable();
  table.restore({
    phase: "playing",
    players: [
      { id: "a", kind: "human", seat: 0, ready: false, connected: true, hand: ["3-diamonds"], score: 6 },
      { id: "b", kind: "bot", seat: 1, ready: false, connected: true, hand: ["4-diamonds"], score: -3 },
      { id: "c", kind: "bot", seat: 2, ready: false, connected: true, hand: ["5-diamonds"], score: -3 }
    ],
    currentPlayerId: "b",
    landlordId: "a",
    bidCandidateId: null,
    firstBidderId: null,
    landlordCards: ["6-diamonds", "7-diamonds", "8-diamonds"],
    bottomCards: [],
    lastPlay: { playerId: "a", cards: ["3-diamonds"] },
    settlement: null,
    passCount: 0,
    bidAttempts: 0,
    robQueue: [],
    robIndex: 0,
    robCount: 1,
    bombCount: 1,
    playCounts: { a: 1 },
    playHistory: [
      { type: "bid", playerId: "a", called: true },
      { type: "play", playerId: "a", cards: ["3-diamonds"] }
    ]
  });
  return table;
}

describe("GameTable.abortRound", () => {
  it("叫地主阶段可流局:回到 ready,清空手牌与历史,保留全部玩家", () => {
    const table = biddingTable();

    const snapshot = table.abortRound();

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.players).toHaveLength(3);
    expect(snapshot.players.every((player) => player.handCount === 0 && !player.ready)).toBe(true);
    expect(snapshot.currentPlayerId).toBeNull();
    expect(snapshot.landlordId).toBeNull();
    expect(table.history()).toHaveLength(0);
    expect(table.playedCards()).toHaveLength(0);
  });

  it("出牌阶段流局:不产生结算,倍数回落,累计分原样保留", () => {
    const table = playingTableWithScores();

    const snapshot = table.abortRound();

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.settlement).toBeNull();
    expect(snapshot.multiplier).toBe(1);
    expect(snapshot.players.map((player) => player.score)).toEqual([6, -3, -3]);
  });

  it("流局后可直接开下一局(三人 ready 即重新发牌)", () => {
    const table = biddingTable();
    table.abortRound();

    table.setReady("a");
    table.setReady("b");
    const result = table.setReady("c");

    expect(result.roundStarted).toBe(true);
    expect(result.snapshot.phase).toBe("bidding");
    expect(result.snapshot.players.every((player) => player.handCount === 17)).toBe(true);
  });

  it("非进行中相位不可流局", () => {
    const readyTable = new GameTable();
    readyTable.addPlayer("a");
    readyTable.addPlayer("b");
    readyTable.addPlayer("c");
    expect(() => readyTable.abortRound()).toThrow(/Cannot abort round during ready phase/);

    const settled = playingTableWithScores();
    // b 用 4 压 a 的 3 后打空手牌 → settled
    settled.playCards("b", ["4-diamonds"]);
    expect(settled.snapshot().phase).toBe("settled");
    expect(() => settled.abortRound()).toThrow(/Cannot abort round during settled phase/);
  });

  it("resetForNextRound 语义不变:仅 settled 可重置", () => {
    const table = biddingTable();
    expect(() => table.resetForNextRound()).toThrow(/Cannot reset during bidding phase/);
  });
});
