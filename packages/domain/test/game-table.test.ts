import { describe, expect, it } from "vitest";
import { GameTable } from "../src";

function readyThreePlayers() {
  const table = new GameTable();
  table.addPlayer("p0");
  table.addPlayer("p1");
  table.addPlayer("p2");
  table.setReady("p0");
  table.setReady("p1");
  table.setReady("p2");
  return table;
}

describe("GameTable bidding and robbing", () => {
  it("tracks existing players and connection state", () => {
    const table = new GameTable();
    const seat = table.addPlayer("p0");

    expect(seat).toBe(0);
    expect(table.hasPlayer("p0")).toBe(true);
    expect(table.hasPlayer("missing")).toBe(false);
    expect(table.snapshot().players[0]?.kind).toBe("human");
    expect(table.snapshot().players[0]?.connected).toBe(true);

    table.setConnected("p0", false);
    expect(table.snapshot().players[0]?.connected).toBe(false);

    const sameSeat = table.addPlayer("p0");
    expect(sameSeat).toBe(0);

    table.setConnected("p0", true);
    expect(table.snapshot().players[0]?.connected).toBe(true);
  });

  it("adds bot players with explicit identity", () => {
    const table = new GameTable();

    expect(table.addBot("bot:alpha")).toBe(0);
    expect(table.snapshot().players[0]).toMatchObject({
      id: "bot:alpha",
      kind: "bot",
      connected: true
    });
    expect(() => table.addBot("alpha")).toThrow("bot: prefix");
  });

  it("releases human seats before a round starts and compacts seat indexes", () => {
    const table = new GameTable();
    table.addPlayer("p0");
    table.addPlayer("p1");
    table.addPlayer("p2");

    table.removePlayerBeforeRound("p1");

    expect(table.snapshot()).toMatchObject({
      phase: "waiting",
      players: [
        { id: "p0", seat: 0 },
        { id: "p2", seat: 1 }
      ]
    });
    expect(table.addPlayer("p3")).toBe(2);
    expect(table.snapshot().phase).toBe("ready");
  });

  it("does not release bot seats or in-round human seats", () => {
    const table = new GameTable();
    table.addBot("bot:alpha");
    expect(() => table.removePlayerBeforeRound("bot:alpha")).toThrow("Only human players");

    const active = readyThreePlayers();
    expect(() => active.removePlayerBeforeRound("p0")).toThrow("Cannot remove players during bidding phase.");
  });

  it("enters bidding after all three players are ready", () => {
    const table = new GameTable();
    table.addPlayer("p0");
    table.addPlayer("p1");
    table.addPlayer("p2");

    expect(table.setReady("p0")).toMatchObject({
      playerId: "p0",
      roundStarted: false,
      snapshot: {
        phase: "ready"
      }
    });
    expect(table.setReady("p1").roundStarted).toBe(false);
    const result = table.setReady("p2");
    const snapshot = table.snapshot();

    expect(result).toMatchObject({
      playerId: "p2",
      roundStarted: true,
      snapshot: {
        phase: "bidding",
        currentPlayerId: "p0"
      }
    });
    expect(snapshot.phase).toBe("bidding");
    expect(snapshot.currentPlayerId).toBe("p0");
    expect(snapshot.landlordId).toBeNull();
    expect(snapshot.landlordCards).toHaveLength(0);
    expect(snapshot.players.map((player) => player.handCount)).toEqual([17, 17, 17]);
  });

  it("rejects ready commands once a round has started", () => {
    const table = readyThreePlayers();

    expect(() => table.setReady("p0")).toThrow("Cannot ready during bidding phase.");
  });

  it("redeals explicitly when nobody calls landlord", () => {
    const table = readyThreePlayers();

    expect(table.bidLandlord("p0", false).redealt).toBe(false);
    expect(table.bidLandlord("p1", false).redealt).toBe(false);
    const result = table.bidLandlord("p2", false);

    expect(result.redealt).toBe(true);
    expect(result.snapshot.phase).toBe("bidding");
    expect(result.snapshot.currentPlayerId).toBe("p0");
    expect(result.snapshot.players.map((player) => player.handCount)).toEqual([17, 17, 17]);
  });

  it("chooses the latest robber as landlord and grants bottom cards", () => {
    const table = readyThreePlayers();

    const bid = table.bidLandlord("p0", true);
    expect(bid.snapshot.phase).toBe("robbing");
    expect(bid.snapshot.bidCandidateId).toBe("p0");
    expect(bid.snapshot.currentPlayerId).toBe("p1");

    const firstRob = table.robLandlord("p1", false);
    expect(firstRob.decided).toBe(false);
    expect(firstRob.snapshot.currentPlayerId).toBe("p2");

    const finalRob = table.robLandlord("p2", true);
    expect(finalRob.decided).toBe(true);
    expect(finalRob.landlordId).toBe("p2");
    expect(finalRob.snapshot.phase).toBe("playing");
    expect(finalRob.snapshot.currentPlayerId).toBe("p2");
    expect(finalRob.snapshot.landlordCards).toHaveLength(3);
    expect(finalRob.snapshot.players.map((player) => player.handCount)).toEqual([17, 17, 20]);
  });

  it("rejects playing before landlord is decided", () => {
    const table = readyThreePlayers();
    const hand = table.getHand("p0");

    expect(() => table.playCards("p0", [hand[0]!.id])).toThrow("Cannot play cards during bidding phase.");
  });

  it("settles score when a player plays their last card", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", true);

    for (const playerId of ["p2", "p0", "p1"] as const) {
      const hand = [...table.getHand(playerId)];
      for (const card of hand) {
        table.playCards(playerId, [card.id]);
        if (table.snapshot().phase === "settled") {
          break;
        }
        table.pass(table.snapshot().currentPlayerId!);
        table.pass(table.snapshot().currentPlayerId!);
      }

      if (table.snapshot().phase === "settled") {
        break;
      }
    }

    const snapshot = table.snapshot();
    expect(snapshot.phase).toBe("settled");
    expect(snapshot.settlement).not.toBeNull();
    expect(snapshot.settlement?.winnerId).toBeTruthy();
    expect(snapshot.settlement?.landlordId).toBe("p2");
    expect(snapshot.settlement?.players).toHaveLength(3);

    const deltas = snapshot.settlement!.players.map((player) => player.scoreDelta);
    expect(deltas.reduce((total, score) => total + score, 0)).toBe(0);
    expect(snapshot.players.map((player) => player.score)).toEqual(
      snapshot.settlement!.players.map((player) => player.totalScore)
    );
  });
});

describe("GameTable multipliers and multi-round", () => {
  function settleWithLandlordSweep(table: GameTable, landlordId: string) {
    const hand = [...table.getHand(landlordId)];
    for (const card of hand) {
      table.playCards(landlordId, [card.id]);
      if (table.snapshot().phase === "settled") {
        return;
      }
      table.pass(table.snapshot().currentPlayerId!);
      table.pass(table.snapshot().currentPlayerId!);
    }
  }

  it("doubles settlement for each rob and for spring", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", true);

    settleWithLandlordSweep(table, "p2");

    const settlement = table.snapshot().settlement!;
    // 抢地主一次 ×2，农民整局未出牌构成春天 ×2。
    expect(settlement.spring).toBe(true);
    expect(settlement.multiplier).toBe(4);
    expect(settlement.players.find((player) => player.role === "landlord")?.scoreDelta).toBe(8);
    expect(settlement.players.filter((player) => player.role === "farmer").map((player) => player.scoreDelta)).toEqual([
      -4, -4
    ]);
  });

  it("uses base multiplier when nobody robs", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", false);

    settleWithLandlordSweep(table, "p0");

    const settlement = table.snapshot().settlement!;
    expect(settlement.spring).toBe(true);
    expect(settlement.multiplier).toBe(2);
    expect(settlement.players.find((player) => player.role === "landlord")?.scoreDelta).toBe(4);
  });

  it("supports a follow-up round after settlement and keeps total scores", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", false);
    settleWithLandlordSweep(table, "p0");

    const totalsBefore = table.snapshot().players.map((player) => player.score);
    expect(totalsBefore.some((score) => score !== 0)).toBe(true);

    const snapshot = table.resetForNextRound();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.multiplier).toBe(1);
    expect(snapshot.settlement).toBeNull();
    expect(snapshot.landlordId).toBeNull();
    expect(snapshot.players.map((player) => player.handCount)).toEqual([0, 0, 0]);
    expect(snapshot.players.map((player) => player.ready)).toEqual([false, false, false]);
    expect(snapshot.players.map((player) => player.score)).toEqual(totalsBefore);

    table.setReady("p0");
    table.setReady("p1");
    const next = table.setReady("p2");
    expect(next.roundStarted).toBe(true);
    expect(next.snapshot.phase).toBe("bidding");
    expect(next.snapshot.players.map((player) => player.handCount)).toEqual([17, 17, 17]);
  });

  it("rejects reset outside the settled phase", () => {
    const table = readyThreePlayers();
    expect(() => table.resetForNextRound()).toThrow("Cannot reset during bidding phase.");
  });
});

describe("GameTable dump/restore", () => {
  function restoreCopy(table: GameTable): GameTable {
    const copy = new GameTable();
    copy.restore(table.dump());
    return copy;
  }

  /** 地主出单张、农民双过的确定性打法，把当前局面打到结算。 */
  function sweepToSettlement(table: GameTable): void {
    while (table.snapshot().phase === "playing") {
      const snapshot = table.snapshot();
      const current = snapshot.currentPlayerId!;
      if (current === snapshot.landlordId) {
        table.playCards(current, [table.getHand(current)[0]!.id]);
      } else {
        table.pass(current);
      }
    }
  }

  it("restores a mid-bidding table including redeal attempts", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", false);

    const restored = restoreCopy(table);
    expect(restored.dump()).toEqual(table.dump());

    // bidAttempts 已恢复为 1，再两个不叫即触发重发
    restored.bidLandlord("p1", false);
    const result = restored.bidLandlord("p2", false);
    expect(result.redealt).toBe(true);
    expect(restored.snapshot().phase).toBe("bidding");
  });

  it("restores a mid-robbing table and finalizes the landlord correctly", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", true);

    const restored = restoreCopy(table);
    const result = restored.robLandlord("p2", false);

    expect(result.decided).toBe(true);
    expect(result.landlordId).toBe("p1");
    const snapshot = restored.snapshot();
    expect(snapshot.phase).toBe("playing");
    // 抢一次 ×2，倍数从恢复的 robCount 延续
    expect(snapshot.multiplier).toBe(2);
    expect(restored.getHand("p1")).toHaveLength(20);
  });

  it("restores a mid-playing table and settles identically to the uninterrupted game", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", true);
    // 打两手后中断
    table.playCards("p2", [table.getHand("p2")[0]!.id]);
    table.pass("p0");
    table.pass("p1");
    table.playCards("p2", [table.getHand("p2")[0]!.id]);

    const restored = restoreCopy(table);
    expect(restored.dump()).toEqual(table.dump());

    sweepToSettlement(table);
    sweepToSettlement(restored);

    // 春天与炸弹/抢地主倍数依赖 playCounts/robCount/bombCount，恢复后结算必须一致
    expect(restored.snapshot().settlement).toEqual(table.snapshot().settlement);
    expect(restored.snapshot().players).toEqual(table.snapshot().players);
  });

  it("restores a settled table and continues into the next round with scores kept", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", false);
    sweepToSettlement(table);

    const restored = restoreCopy(table);
    expect(restored.snapshot().settlement).toEqual(table.snapshot().settlement);

    const totals = table.snapshot().players.map((player) => player.score);
    const snapshot = restored.resetForNextRound();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.players.map((player) => player.score)).toEqual(totals);
  });

  it("rejects restoring into a table that is already in use", () => {
    const source = readyThreePlayers();
    const used = new GameTable();
    used.addPlayer("someone");
    expect(() => used.restore(source.dump())).toThrow("fresh table");
  });

  it("rejects corrupted states", () => {
    const table = readyThreePlayers();
    table.bidLandlord("p0", true);
    table.robLandlord("p1", false);
    table.robLandlord("p2", false);
    const state = table.dump();

    // 重复牌：把 p1 的第一张改成 p0 的第一张
    const duplicated = {
      ...state,
      players: state.players.map((player, index) =>
        index === 1 ? { ...player, hand: [state.players[0]!.hand[0]!, ...player.hand.slice(1)] } : player
      )
    };
    expect(() => new GameTable().restore(duplicated)).toThrow("duplicate cards");

    // 座位冲突
    const seatClash = {
      ...state,
      players: state.players.map((player, index) => (index === 1 ? { ...player, seat: 0 as const } : player))
    };
    expect(() => new GameTable().restore(seatClash)).toThrow("seats");

    // 相位矛盾：playing 却没有地主
    expect(() => new GameTable().restore({ ...state, landlordId: null })).toThrow("inconsistent playing state");

    // 当前玩家不在座
    expect(() => new GameTable().restore({ ...state, currentPlayerId: "ghost" })).toThrow("not seated");

    // lastPlay 出牌人不在座
    expect(() =>
      new GameTable().restore({ ...state, lastPlay: { playerId: "ghost", cards: state.players[0]!.hand.slice(0, 1) } })
    ).toThrow("lastPlay player");

    // playing 相位不允许空手牌或已有结算
    const emptyHand = {
      ...state,
      players: state.players.map((player, index) => (index === 1 ? { ...player, hand: [] } : player))
    };
    expect(() => new GameTable().restore(emptyHand)).toThrow("non-empty hands");

    // 计数字段必须是非负整数
    expect(() => new GameTable().restore({ ...state, bombCount: -1 })).toThrow("non-negative integer");
    expect(() => new GameTable().restore({ ...state, passCount: 3 })).toThrow("passCount out of range");
  });

  it("rejects corrupted robbing and inter-round states", () => {
    const robbing = readyThreePlayers();
    robbing.bidLandlord("p0", true);
    robbing.robLandlord("p1", true);
    const robState = robbing.dump();

    // 抢地主轮转指针与当前玩家脱节
    expect(() => new GameTable().restore({ ...robState, robIndex: 0 })).toThrow("rob queue position");
    // 抢地主队列出现重复玩家
    expect(() =>
      new GameTable().restore({ ...robState, robQueue: [robState.robQueue[1]!, robState.robQueue[1]!] })
    ).toThrow("duplicate players");

    // 局间相位不允许残留上一局的牌局数据
    const settled = readyThreePlayers();
    settled.bidLandlord("p0", true);
    settled.robLandlord("p1", false);
    settled.robLandlord("p2", false);
    while (settled.snapshot().phase === "playing") {
      const snapshot = settled.snapshot();
      const current = snapshot.currentPlayerId!;
      if (current === snapshot.landlordId) {
        settled.playCards(current, [settled.getHand(current)[0]!.id]);
      } else {
        settled.pass(current);
      }
    }
    const interRound = settled.dump();
    settled.resetForNextRound();
    const cleanState = settled.dump();
    expect(() => new GameTable().restore({ ...cleanState, settlement: interRound.settlement })).toThrow(
      "leftover round data"
    );
    expect(() => new GameTable().restore({ ...cleanState, landlordCards: interRound.landlordCards })).toThrow(
      "leftover round data"
    );
  });
});
