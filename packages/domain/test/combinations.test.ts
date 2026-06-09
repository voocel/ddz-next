import { describe, expect, it } from "vitest";
import { canBeat, createDeck, dealCards, identifyCombination, parseCardIds, suggestPlay } from "../src";

describe("Dou Dizhu card combinations", () => {
  it("identifies core combinations", () => {
    expect(identifyCombination(parseCardIds(["3-clubs"]))?.kind).toBe("single");
    expect(identifyCombination(parseCardIds(["3-clubs", "3-hearts"]))?.kind).toBe("pair");
    expect(identifyCombination(parseCardIds(["3-clubs", "3-hearts", "3-spades"]))?.kind).toBe("trio");
    expect(identifyCombination(parseCardIds(["3-clubs", "4-hearts", "5-spades", "6-clubs", "7-diamonds"]))?.kind).toBe(
      "straight"
    );
    expect(
      identifyCombination(parseCardIds(["3-clubs", "3-hearts", "4-spades", "4-clubs", "5-diamonds", "5-hearts"]))
        ?.kind
    ).toBe("pair_sequence");
    expect(identifyCombination(parseCardIds(["SJ", "BJ"]))?.kind).toBe("rocket");
  });

  it("compares normal combinations and bombs", () => {
    const pair3 = identifyCombination(parseCardIds(["3-clubs", "3-hearts"]));
    const pair4 = identifyCombination(parseCardIds(["4-clubs", "4-hearts"]));
    const bomb3 = identifyCombination(parseCardIds(["3-clubs", "3-hearts", "3-spades", "3-diamonds"]));
    const rocket = identifyCombination(parseCardIds(["SJ", "BJ"]));

    expect(pair3).not.toBeNull();
    expect(pair4).not.toBeNull();
    expect(bomb3).not.toBeNull();
    expect(rocket).not.toBeNull();
    expect(canBeat(pair4!, pair3)).toBe(true);
    expect(canBeat(pair3!, pair4)).toBe(false);
    expect(canBeat(bomb3!, pair4)).toBe(true);
    expect(canBeat(rocket!, bomb3)).toBe(true);
  });

  it("deals three hands and landlord cards from a full deck", () => {
    const result = dealCards(createDeck());

    expect(result.hands).toHaveLength(3);
    expect(result.hands[0]).toHaveLength(17);
    expect(result.hands[1]).toHaveLength(17);
    expect(result.hands[2]).toHaveLength(17);
    expect(result.landlordCards).toHaveLength(3);
  });

  it("suggests the smallest same-kind play before using bombs", () => {
    const hand = parseCardIds(["3-clubs", "4-clubs", "4-hearts", "7-clubs", "7-hearts", "7-spades", "9-clubs"]);
    const previousSingle = identifyCombination(parseCardIds(["3-hearts"]));
    const previousPair = identifyCombination(parseCardIds(["6-clubs", "6-hearts"]));

    expect(suggestPlay(hand, previousSingle!)?.map((card) => card.id)).toEqual(["4-clubs"]);
    expect(suggestPlay(hand, previousPair!)?.map((card) => card.id)).toEqual(["7-clubs", "7-hearts"]);
  });

  it("suggests sequences with matching length", () => {
    const hand = parseCardIds([
      "3-clubs",
      "4-clubs",
      "5-clubs",
      "6-clubs",
      "7-clubs",
      "8-clubs",
      "9-clubs",
      "10-clubs",
      "J-clubs"
    ]);
    const previous = identifyCombination(parseCardIds(["3-hearts", "4-hearts", "5-hearts", "6-hearts", "7-hearts"]));

    expect(suggestPlay(hand, previous!)?.map((card) => card.id)).toEqual([
      "4-clubs",
      "5-clubs",
      "6-clubs",
      "7-clubs",
      "8-clubs"
    ]);
  });

  it("suggests trio, plane, and four-card combinations with wings", () => {
    const trioHand = parseCardIds(["5-clubs", "5-hearts", "5-spades", "7-clubs", "9-clubs"]);
    const trioPrevious = identifyCombination(parseCardIds(["4-clubs", "4-hearts", "4-spades", "6-clubs"]));
    expect(suggestPlay(trioHand, trioPrevious!)?.map((card) => card.id)).toEqual([
      "5-clubs",
      "5-hearts",
      "5-spades",
      "7-clubs"
    ]);

    const planeHand = parseCardIds([
      "5-clubs",
      "5-hearts",
      "5-spades",
      "6-clubs",
      "6-hearts",
      "6-spades",
      "8-clubs",
      "9-clubs"
    ]);
    const planePrevious = identifyCombination(
      parseCardIds(["3-clubs", "3-hearts", "3-spades", "4-clubs", "4-hearts", "4-spades", "7-clubs", "8-hearts"])
    );
    expect(suggestPlay(planeHand, planePrevious!)?.map((card) => card.id)).toEqual([
      "5-clubs",
      "5-hearts",
      "5-spades",
      "6-clubs",
      "6-hearts",
      "6-spades",
      "8-clubs",
      "9-clubs"
    ]);

    const fourHand = parseCardIds(["6-clubs", "6-diamonds", "6-hearts", "6-spades", "8-clubs", "9-clubs"]);
    const fourPrevious = identifyCombination(
      parseCardIds(["5-clubs", "5-diamonds", "5-hearts", "5-spades", "7-clubs", "8-hearts"])
    );
    expect(suggestPlay(fourHand, fourPrevious!)?.map((card) => card.id)).toEqual([
      "6-clubs",
      "6-diamonds",
      "6-hearts",
      "6-spades",
      "8-clubs",
      "9-clubs"
    ]);
  });

  it("falls back to bombs and rocket only when needed", () => {
    const bombHand = parseCardIds(["3-clubs", "4-clubs", "4-diamonds", "4-hearts", "4-spades"]);
    const previousPair = identifyCombination(parseCardIds(["A-clubs", "A-hearts"]));
    expect(suggestPlay(bombHand, previousPair!)?.map((card) => card.id)).toEqual([
      "4-clubs",
      "4-diamonds",
      "4-hearts",
      "4-spades"
    ]);

    const rocketHand = parseCardIds(["3-clubs", "SJ", "BJ"]);
    const previousBomb = identifyCombination(parseCardIds(["A-clubs", "A-diamonds", "A-hearts", "A-spades"]));
    expect(suggestPlay(rocketHand, previousBomb!)?.map((card) => card.id)).toEqual(["SJ", "BJ"]);
  });

  it("returns null when no legal suggestion exists", () => {
    const hand = parseCardIds(["3-clubs", "4-clubs", "5-clubs"]);
    const previous = identifyCombination(parseCardIds(["A-clubs", "A-hearts"]));

    expect(suggestPlay(hand, previous!)).toBeNull();
  });
});
