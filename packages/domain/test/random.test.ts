import { describe, expect, it } from "vitest";
import { GameTable, mulberry32, seedFromString } from "../src";

function seededReadyTable(seed: string): GameTable {
  const table = new GameTable(mulberry32(seedFromString(seed)));
  table.addPlayer("p0");
  table.addPlayer("p1");
  table.addPlayer("p2");
  table.setReady("p0");
  table.setReady("p1");
  table.setReady("p2");
  return table;
}

describe("mulberry32 / seedFromString", () => {
  it("同 seed 产出同一随机序列,不同 seed 序列不同", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("seedFromString 对同一文本稳定,对不同文本区分", () => {
    expect(seedFromString("match-1")).toBe(seedFromString("match-1"));
    expect(seedFromString("match-1")).not.toBe(seedFromString("match-2"));
  });
});

describe("GameTable seeded dealing", () => {
  it("同 seed 两张桌发出完全相同的手牌与底牌", () => {
    const first = seededReadyTable("arena-board-1").dump();
    const second = seededReadyTable("arena-board-1").dump();

    expect(first.players.map((player) => player.hand)).toEqual(second.players.map((player) => player.hand));
    expect(first.bottomCards).toEqual(second.bottomCards);
  });

  it("不同 seed 发牌不同", () => {
    const first = seededReadyTable("arena-board-1").dump();
    const second = seededReadyTable("arena-board-2").dump();

    expect(first.players.map((player) => player.hand)).not.toEqual(second.players.map((player) => player.hand));
  });

  it("全员不叫触发重发时,同 seed 的重发序列同样确定(有状态 PRNG 流)", () => {
    const redealAll = (table: GameTable): void => {
      // 三人依次不叫 → 第三人触发 redeal(dealForBidding 消耗 PRNG 流的下一段)
      for (let i = 0; i < 3; i += 1) {
        table.bidLandlord(table.snapshot().currentPlayerId!, false);
      }
    };
    const first = seededReadyTable("arena-board-3");
    const second = seededReadyTable("arena-board-3");
    redealAll(first);
    redealAll(second);

    expect(first.dump().players.map((player) => player.hand)).toEqual(
      second.dump().players.map((player) => player.hand)
    );
  });
});
