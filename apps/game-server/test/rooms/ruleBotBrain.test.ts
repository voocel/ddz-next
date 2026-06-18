import { describe, expect, it } from "vitest";
import { identifyCombination, parseCardIds, type CardId, type GameSnapshot } from "@ddz/domain";
import { decideBotAction } from "../../src/rooms/ruleBotBrain";

describe("decideBotAction", () => {
  it("rejects non-bot and inactive players", () => {
    expect(() => decideBotAction(createSnapshot("playing"), "p0", [])).toThrow("not a bot");
    expect(() => decideBotAction(createSnapshot("playing"), "bot:test:2", [])).toThrow("inactive player");
  });

  it("declines bidding and robbing turns", () => {
    expect(decideBotAction(createSnapshot("bidding"), "bot:test:1", [])).toEqual({
      type: "bid_landlord",
      called: false
    });
    expect(decideBotAction(createSnapshot("robbing"), "bot:test:1", [])).toEqual({
      type: "rob_landlord",
      robbed: false
    });
  });

  it("calls and robs landlord with strong hands", () => {
    const callableHand = parseCardIds([
      "BJ",
      "2-clubs",
      "2-diamonds",
      "A-clubs",
      "A-diamonds",
      "K-clubs",
      "Q-clubs",
      "3-clubs",
      "3-diamonds",
      "5-clubs",
      "5-diamonds",
      "7-clubs",
      "7-diamonds",
      "9-clubs",
      "9-diamonds",
      "J-clubs",
      "J-diamonds",
      "Q-spades"
    ]);
    const dominantHand = parseCardIds([
      "BJ",
      "SJ",
      "2-clubs",
      "2-diamonds",
      "2-hearts",
      "2-spades",
      "A-clubs",
      "A-diamonds",
      "A-hearts",
      "K-clubs",
      "K-diamonds",
      "K-hearts",
      "Q-clubs",
      "Q-diamonds",
      "J-clubs",
      "10-clubs",
      "9-clubs"
    ]);

    expect(decideBotAction(createSnapshot("bidding"), "bot:test:1", callableHand)).toEqual({
      type: "bid_landlord",
      called: true
    });
    expect(decideBotAction(createSnapshot("robbing"), "bot:test:1", callableHand)).toEqual({
      type: "rob_landlord",
      robbed: false
    });
    expect(decideBotAction(createSnapshot("robbing"), "bot:test:1", dominantHand)).toEqual({
      type: "rob_landlord",
      robbed: true
    });
  });

  it("passes when it cannot beat the previous play", () => {
    expect(
      decideBotAction(createSnapshot("playing", ["BJ"]), "bot:test:1", parseCardIds(["3-clubs", "4-clubs"]))
    ).toEqual({
      type: "pass"
    });
  });

  it("plays the smallest suggested cards when leading", () => {
    expect(decideBotAction(createSnapshot("playing"), "bot:test:1", parseCardIds(["8-clubs", "3-clubs"]))).toEqual({
      type: "play_cards",
      cards: ["3-clubs"]
    });
  });

  it("plays a legal response that beats the previous play", () => {
    expect(
      decideBotAction(createSnapshot("playing", ["7-clubs"]), "bot:test:1", parseCardIds(["8-clubs", "3-clubs"]))
    ).toEqual({
      type: "play_cards",
      cards: ["8-clubs"]
    });
  });

  it("rejects phases without active bot turns", () => {
    expect(() => decideBotAction(createSnapshot("ready"), "bot:test:1", [])).toThrow("inactive player");
  });
});

function createSnapshot(phase: GameSnapshot["phase"], previousCardIds: readonly CardId[] = []): GameSnapshot {
  const previousCards = parseCardIds(previousCardIds);
  const previousCombination = previousCards.length ? identifyCombination(previousCards) : null;
  if (previousCards.length && !previousCombination) {
    throw new Error("Test fixture must be a valid combination.");
  }

  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "bot:test:1", kind: "bot", seat: 1, ready: false, handCount: 0, connected: true, score: 0 },
      { id: "bot:test:2", kind: "bot", seat: 2, ready: false, handCount: 0, connected: true, score: 0 }
    ],
    currentPlayerId: phase === "ready" || phase === "settled" || phase === "waiting" ? null : "bot:test:1",
    landlordId: phase === "playing" ? "p0" : null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay:
      previousCombination && previousCards.length
        ? {
            playerId: "p0",
            cards: previousCards,
            combination: previousCombination
          }
        : null,
    passCount: 0,
    settlement: null
  };
}
