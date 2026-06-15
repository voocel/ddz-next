import { describe, expect, it } from "vitest";
import type { GamePhase, GameSnapshot, PublicPlay } from "@ddz/domain";
import { botTurnDelayMs } from "../../src/rooms/botTiming";

// 仅 phase 与 lastPlay 参与延迟选择,其余字段给最小合法占位
function snapshot(phase: GamePhase, lastPlay: PublicPlay | null = null): GameSnapshot {
  return {
    phase,
    players: [],
    currentPlayerId: null,
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}

const aPlay: PublicPlay = {
  playerId: "p0",
  cards: [],
  combination: { kind: "single", cards: [], mainRank: "3", length: 1 }
};

describe("botTurnDelayMs", () => {
  it("叫/抢用同一短停顿区间 [1200, 2200]", () => {
    expect(botTurnDelayMs(snapshot("bidding"), () => 0)).toBe(1200);
    expect(botTurnDelayMs(snapshot("robbing"), () => 0)).toBe(1200);
    expect(botTurnDelayMs(snapshot("bidding"), () => 0.999999)).toBe(2200);
  });

  it("自由领出(lastPlay 为空)想得最久 [2000, 3500]", () => {
    expect(botTurnDelayMs(snapshot("playing", null), () => 0)).toBe(2000);
    expect(botTurnDelayMs(snapshot("playing", null), () => 0.999999)).toBe(3500);
  });

  it("跟牌/过牌(lastPlay 非空)更快 [1500, 2800]", () => {
    expect(botTurnDelayMs(snapshot("playing", aPlay), () => 0)).toBe(1500);
    expect(botTurnDelayMs(snapshot("playing", aPlay), () => 0.999999)).toBe(2800);
  });

  it("同一随机量下,领出 > 跟牌 > 叫抢,体现情境差异", () => {
    const lead = botTurnDelayMs(snapshot("playing", null), () => 0.5);
    const follow = botTurnDelayMs(snapshot("playing", aPlay), () => 0.5);
    const bid = botTurnDelayMs(snapshot("bidding"), () => 0.5);
    expect(lead).toBeGreaterThan(follow);
    expect(follow).toBeGreaterThan(bid);
  });

  it("默认随机源产出的延迟恒在最宽区间 [1200, 3500] 内", () => {
    for (let i = 0; i < 200; i += 1) {
      const delay = botTurnDelayMs(snapshot("playing", null));
      expect(delay).toBeGreaterThanOrEqual(1200);
      expect(delay).toBeLessThanOrEqual(3500);
    }
  });
});
