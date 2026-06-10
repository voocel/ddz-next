import { describe, expect, it } from "vitest";
import type { CardId } from "@ddz/domain";
import type { CardDto, GameSnapshotDto } from "@ddz/protocol";
import { combinationKindLabel, describeSelectedCards, validateSelectedPlay } from "./playValidation";

describe("play validation", () => {
  it("accepts a selected play that beats the previous play", () => {
    const hand = cards("5-clubs", "6-clubs", "9-clubs");
    const result = validateSelectedPlay(hand, new Set<CardId>(["6-clubs"]), snapshot({ previous: cards("5-hearts") }), "p0");

    expect(result).toMatchObject({
      ok: true,
      cardIds: ["6-clubs"]
    });
    expect(result.ok && combinationKindLabel(result.combination.kind)).toBe("单牌");
  });

  it("rejects an invalid local selection before sending a command", () => {
    const hand = cards("5-clubs", "6-clubs");
    const result = validateSelectedPlay(hand, new Set<CardId>(["5-clubs", "6-clubs"]), snapshot({ previous: null }), "p0");

    expect(result).toEqual({
      ok: false,
      reason: "所选牌不是合法牌型"
    });
  });

  it("rejects a play that cannot beat the previous play", () => {
    const hand = cards("5-clubs", "6-clubs");
    const result = validateSelectedPlay(hand, new Set<CardId>(["5-clubs"]), snapshot({ previous: cards("6-hearts") }), "p0");

    expect(result).toEqual({
      ok: false,
      reason: "所选牌压不过上一手"
    });
  });

  it("describes the current selected combination", () => {
    expect(describeSelectedCards(cards("7-clubs", "7-hearts"), new Set<CardId>(["7-clubs", "7-hearts"]))).toBe(
      "对子 梅花7 红桃7"
    );
  });
});

function snapshot(options: { readonly previous: CardDto[] | null }): GameSnapshotDto {
  return {
    phase: "playing",
    players: [
      { id: "p0", kind: "human", seat: 0, ready: true, handCount: 2, connected: true, score: 0 },
      { id: "p1", kind: "human", seat: 1, ready: true, handCount: 2, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: true, handCount: 2, connected: true, score: 0 }
    ],
    currentPlayerId: "p0",
    landlordId: "p0",
    bidCandidateId: "p0",
    landlordCards: [],
    lastPlay: options.previous
      ? {
          playerId: "p1",
          cards: [...options.previous],
          combination: {
            kind: "single",
            cards: [...options.previous],
            mainRank: options.previous[0]!.rank,
            length: options.previous.length
          }
        }
      : null,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}

function cards(...ids: CardId[]): CardDto[] {
  return ids.map((id) => {
    if (id === "SJ" || id === "BJ") {
      return {
        id,
        rank: id
      };
    }

    const [rank, suit] = id.split("-");
    if (!rank || !suit) {
      throw new Error(`Invalid test card id: ${id}`);
    }

    return {
      id,
      rank: rank as CardDto["rank"],
      suit: suit as NonNullable<CardDto["suit"]>
    };
  });
}
