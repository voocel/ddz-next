import { describe, expect, it } from "vitest";
import { identifyCombination, parseCardIds, type GameSnapshot } from "@ddz/domain";
import { decideTimeoutAction } from "../../src/rooms/timeoutAction";

describe("decideTimeoutAction", () => {
  it("declines bidding and robbing turns", () => {
    expect(decideTimeoutAction(createSnapshot("bidding"), "p0", []).type).toBe("bid_landlord");
    expect(decideTimeoutAction(createSnapshot("bidding"), "p0", [])).toEqual({
      type: "bid_landlord",
      called: false
    });
    expect(decideTimeoutAction(createSnapshot("robbing"), "p0", [])).toEqual({
      type: "rob_landlord",
      robbed: false
    });
  });

  it("passes when there is a previous play", () => {
    const previousCards = parseCardIds(["3-clubs"]);
    const combination = identifyCombination(previousCards);
    if (!combination) {
      throw new Error("Test fixture must be a valid combination.");
    }

    expect(
      decideTimeoutAction(
        {
          ...createSnapshot("playing"),
          lastPlay: {
            playerId: "p2",
            cards: previousCards,
            combination
          }
        },
        "p0",
        parseCardIds(["4-clubs"])
      )
    ).toEqual({
      type: "pass"
    });
  });

  it("plays the smallest suggested card when leading", () => {
    expect(decideTimeoutAction(createSnapshot("playing"), "p0", parseCardIds(["7-clubs", "3-clubs"]))).toEqual({
      type: "play_cards",
      cards: ["3-clubs"]
    });
  });

  it("rejects inactive players and phases without turns", () => {
    expect(() => decideTimeoutAction(createSnapshot("playing"), "p1", [])).toThrow("inactive player");
    expect(() => decideTimeoutAction(createSnapshot("ready"), "p0", [])).toThrow("ready phase");
  });
});

function createSnapshot(phase: GameSnapshot["phase"]): GameSnapshot {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "p1", kind: "human", seat: 1, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: false, handCount: 0, connected: true, score: 0 }
    ],
    currentPlayerId: phase === "ready" || phase === "settled" || phase === "waiting" ? null : "p0",
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    settlement: null
  };
}
