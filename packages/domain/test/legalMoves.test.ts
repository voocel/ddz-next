import { describe, expect, it } from "vitest";
import type { CardId, Combination, LegalMove } from "../src";
import { canBeat, enumerateLegalMoves, identifyCombination, parseCardIds } from "../src";

function hand(ids: readonly CardId[]) {
  return parseCardIds([...ids]);
}

function combo(ids: readonly CardId[]): Combination {
  const result = identifyCombination(parseCardIds([...ids]));
  if (!result) {
    throw new Error(`Invalid combination for test: ${ids.join(",")}`);
  }
  return result;
}

function kindCounts(moves: readonly LegalMove[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const move of moves) {
    counts[move.combination.kind] = (counts[move.combination.kind] ?? 0) + 1;
  }
  return counts;
}

function ids(move: LegalMove): string[] {
  return move.cards.map((card) => card.id);
}

describe("enumerateLegalMoves", () => {
  it("returns nothing for an empty hand", () => {
    expect(enumerateLegalMoves([], null)).toEqual([]);
  });

  it("enumerates every legal lead for a small hand", () => {
    // 33 4 5:三个单张(3/4/5)+ 一个对子(33),无更长结构。
    const moves = enumerateLegalMoves(hand(["3-clubs", "3-hearts", "4-spades", "5-clubs"]), null);
    expect(kindCounts(moves)).toEqual({ single: 3, pair: 1 });
  });

  it("yields each enumerated move as a self-consistent, identifiable combination", () => {
    const moves = enumerateLegalMoves(hand(["3-clubs", "3-hearts", "3-spades", "4-clubs", "5-clubs", "5-hearts"]), null);
    for (const move of moves) {
      const identified = identifyCombination(move.cards);
      expect(identified?.kind).toBe(move.combination.kind);
      expect(identified?.mainRank).toBe(move.combination.mainRank);
    }
  });

  it("canonicalizes trio wings to a single cheapest representative", () => {
    // 333 4 55:三带一只给「带最低单 4」一个代表,不为每个可选单牌各列一手。
    const moves = enumerateLegalMoves(hand(["3-clubs", "3-hearts", "3-spades", "4-clubs", "5-clubs", "5-hearts"]), null);
    const trioWithSingle = moves.filter((move) => move.combination.kind === "trio_with_single");
    const trioWithPair = moves.filter((move) => move.combination.kind === "trio_with_pair");

    expect(trioWithSingle).toHaveLength(1);
    expect(ids(trioWithSingle[0]!)).toEqual(["3-clubs", "3-hearts", "3-spades", "4-clubs"]);
    expect(trioWithPair).toHaveLength(1);
    expect(ids(trioWithPair[0]!)).toEqual(["3-clubs", "3-hearts", "3-spades", "5-clubs", "5-hearts"]);
  });

  it("enumerates a straight as a single move", () => {
    const moves = enumerateLegalMoves(
      hand(["3-clubs", "4-hearts", "5-spades", "6-clubs", "7-diamonds"]),
      null
    );
    const straights = moves.filter((move) => move.combination.kind === "straight");
    expect(straights).toHaveLength(1);
    expect(straights[0]!.combination.mainRank).toBe("7");
    expect(straights[0]!.cards).toHaveLength(5);
  });

  it("only returns moves that beat the previous play when following", () => {
    const previous = combo(["4-clubs"]);
    const moves = enumerateLegalMoves(hand(["3-hearts", "5-clubs", "6-clubs"]), previous);

    expect(moves.map((move) => move.combination.mainRank)).toEqual(["5", "6"]);
    for (const move of moves) {
      expect(canBeat(move.combination, previous)).toBe(true);
    }
  });

  it("returns no follow when the hand cannot beat the previous play", () => {
    // 只有一对 3,压不过对 4,也无炸弹/火箭。
    expect(enumerateLegalMoves(hand(["3-clubs", "3-hearts"]), combo(["4-clubs", "4-hearts"]))).toEqual([]);
  });

  it("offers a bomb to beat a non-bomb play", () => {
    const moves = enumerateLegalMoves(
      hand(["3-clubs", "3-hearts", "3-spades", "3-diamonds"]),
      combo(["A-clubs"])
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.combination.kind).toBe("bomb");
  });

  it("offers the rocket to beat a bomb", () => {
    const moves = enumerateLegalMoves(hand(["SJ", "BJ"]), combo(["2-clubs", "2-hearts", "2-spades", "2-diamonds"]));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.combination.kind).toBe("rocket");
  });

  it("follows a four-with-two-pairs with a higher one (and a plain bomb)", () => {
    const previous = combo(["5-clubs", "5-hearts", "5-spades", "5-diamonds", "3-clubs", "3-hearts", "4-clubs", "4-hearts"]);
    const moves = enumerateLegalMoves(
      hand(["8-clubs", "8-hearts", "8-spades", "8-diamonds", "9-clubs", "9-hearts", "10-clubs", "10-hearts"]),
      previous
    );
    const quadPairs = moves.find((move) => move.combination.kind === "four_with_two_pairs");
    expect(quadPairs?.combination.mainRank).toBe("8");
    // 8888 也是炸弹,炸弹可压非炸弹的四带两对。
    expect(moves.some((move) => move.combination.kind === "bomb" && move.combination.mainRank === "8")).toBe(true);
  });

  it("follows a plane-with-pairs with a higher plane of the same length", () => {
    const previous = combo([
      "3-clubs", "3-hearts", "3-spades", "4-clubs", "4-hearts", "4-spades", "5-clubs", "5-hearts", "6-clubs", "6-hearts"
    ]);
    const moves = enumerateLegalMoves(
      hand([
        "8-clubs", "8-hearts", "8-spades", "9-clubs", "9-hearts", "9-spades", "J-clubs", "J-hearts", "Q-clubs", "Q-hearts"
      ]),
      previous
    );
    const plane = moves.find((move) => move.combination.kind === "plane_with_pairs");
    expect(plane?.combination.mainRank).toBe("9");
    expect(plane?.combination.chainLength).toBe(2);
    for (const move of moves) {
      expect(canBeat(move.combination, previous)).toBe(true);
    }
  });

  it("is deterministic and ordered", () => {
    const cards = hand(["3-clubs", "3-hearts", "3-spades", "4-clubs", "5-clubs", "5-hearts"]);
    const first = enumerateLegalMoves(cards, null);
    const second = enumerateLegalMoves(cards, null);
    expect(first.map(ids)).toEqual(second.map(ids));
  });
});
