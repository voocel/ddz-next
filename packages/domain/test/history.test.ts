import { describe, expect, it } from "vitest";
import { GameTable } from "../src";

function readyThreePlayers(): GameTable {
  const table = new GameTable();
  table.addPlayer("p0");
  table.addPlayer("p1");
  table.addPlayer("p2");
  table.setReady("p0");
  table.setReady("p1");
  table.setReady("p2");
  return table;
}

describe("GameTable bid/rob history", () => {
  it("叫/抢动作按序进入公开历史,并随 dump/restore 无损往返", () => {
    const table = readyThreePlayers();
    const bidder1 = table.snapshot().currentPlayerId!;
    table.bidLandlord(bidder1, false);
    const bidder2 = table.snapshot().currentPlayerId!;
    table.bidLandlord(bidder2, true);
    const robber = table.snapshot().currentPlayerId!;
    table.robLandlord(robber, true);

    const expected = [
      { type: "bid", playerId: bidder1, called: false },
      { type: "bid", playerId: bidder2, called: true },
      { type: "rob", playerId: robber, robbed: true }
    ];
    expect(table.history()).toEqual(expected);

    const restored = new GameTable();
    restored.restore(table.dump());
    expect(restored.history()).toEqual(expected);
    expect(restored.dump()).toEqual(table.dump());
  });

  it("全员不叫触发重发时历史清空(新一副牌)", () => {
    const table = readyThreePlayers();
    for (let i = 0; i < 3; i += 1) {
      table.bidLandlord(table.snapshot().currentPlayerId!, false);
    }

    expect(table.snapshot().phase).toBe("bidding");
    expect(table.history()).toEqual([]);
  });

  it("playedCards 只统计出牌动作,不受叫抢条目影响", () => {
    const table = readyThreePlayers();
    table.bidLandlord(table.snapshot().currentPlayerId!, true);
    table.robLandlord(table.snapshot().currentPlayerId!, false);
    table.robLandlord(table.snapshot().currentPlayerId!, false);

    expect(table.snapshot().phase).toBe("playing");
    expect(table.playedCards()).toEqual([]);
    expect(table.history().every((entry) => entry.type === "bid" || entry.type === "rob")).toBe(true);
  });
});
