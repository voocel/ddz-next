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
