import type { Card, Rank } from "./cards.js";
import { compareRank, getRankValue, sortCards } from "./cards.js";

export const COMBINATION_KINDS = [
  "single",
  "pair",
  "trio",
  "trio_with_single",
  "trio_with_pair",
  "straight",
  "pair_sequence",
  "plane",
  "plane_with_singles",
  "plane_with_pairs",
  "four_with_two_singles",
  "four_with_two_pairs",
  "bomb",
  "rocket"
] as const;

export type CombinationKind = (typeof COMBINATION_KINDS)[number];

export interface Combination {
  readonly kind: CombinationKind;
  readonly cards: readonly Card[];
  readonly mainRank: Rank;
  readonly length: number;
  readonly chainLength?: number | undefined;
}

interface RankGroup {
  readonly rank: Rank;
  readonly count: number;
  readonly value: number;
}

const MAX_CHAIN_RANK_VALUE = getRankValue("A");

export function identifyCombination(cards: readonly Card[]): Combination | null {
  if (cards.length === 0) {
    return null;
  }

  const sorted = sortCards(cards, "asc");
  const groups = getRankGroups(sorted);
  const byCount = (count: number) => groups.filter((group) => group.count === count);
  const singles = byCount(1);
  const pairs = byCount(2);
  const trios = byCount(3);
  const quads = byCount(4);

  if (cards.length === 1) {
    return createCombination("single", sorted, sorted[0]!.rank);
  }

  if (cards.length === 2) {
    const ranks = new Set(sorted.map((card) => card.rank));
    if (ranks.has("SJ") && ranks.has("BJ")) {
      return createCombination("rocket", sorted, "BJ");
    }
    if (pairs.length === 1) {
      return createCombination("pair", sorted, pairs[0]!.rank);
    }
    return null;
  }

  if (cards.length === 3 && trios.length === 1) {
    return createCombination("trio", sorted, trios[0]!.rank);
  }

  if (cards.length === 4) {
    if (quads.length === 1) {
      return createCombination("bomb", sorted, quads[0]!.rank);
    }
    if (trios.length === 1 && singles.length === 1) {
      return createCombination("trio_with_single", sorted, trios[0]!.rank);
    }
    return null;
  }

  if (cards.length === 5 && trios.length === 1 && pairs.length === 1) {
    return createCombination("trio_with_pair", sorted, trios[0]!.rank);
  }

  const straight = identifyStraight(sorted);
  if (straight) {
    return straight;
  }

  const pairSequence = identifyPairSequence(sorted, pairs, groups);
  if (pairSequence) {
    return pairSequence;
  }

  const plane = identifyPlane(sorted, trios, singles, pairs, groups);
  if (plane) {
    return plane;
  }

  if (cards.length === 6 && quads.length === 1 && singles.length === 2 && !wingsSplitRocket(singles)) {
    return createCombination("four_with_two_singles", sorted, quads[0]!.rank);
  }

  if (cards.length === 8 && quads.length === 1 && pairs.length === 2) {
    return createCombination("four_with_two_pairs", sorted, quads[0]!.rank);
  }

  return null;
}

export function canBeat(candidate: Combination, previous: Combination | null): boolean {
  if (!previous) {
    return true;
  }

  if (candidate.kind === "rocket") {
    return previous.kind !== "rocket";
  }

  if (previous.kind === "rocket") {
    return false;
  }

  if (candidate.kind === "bomb" && previous.kind !== "bomb") {
    return true;
  }

  if (candidate.kind !== previous.kind) {
    return false;
  }

  // 同类型下 length 由 kind 与 chainLength 唯一决定，校验 chainLength 即可。
  if (candidate.chainLength !== previous.chainLength) {
    return false;
  }

  return compareRank(candidate.mainRank, previous.mainRank) > 0;
}

function createCombination(
  kind: CombinationKind,
  cards: readonly Card[],
  mainRank: Rank,
  chainLength?: number
): Combination {
  return {
    kind,
    cards: sortCards(cards, "asc"),
    mainRank,
    length: cards.length,
    ...(chainLength === undefined ? {} : { chainLength })
  };
}

// 双王（火箭）不允许被拆开当作带牌的翼；单张王可以。
function wingsSplitRocket(wings: readonly RankGroup[]): boolean {
  return wings.some((group) => group.rank === "SJ") && wings.some((group) => group.rank === "BJ");
}

function getRankGroups(cards: readonly Card[]): RankGroup[] {
  const counts = new Map<Rank, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([rank, count]) => ({
      rank,
      count,
      value: getRankValue(rank)
    }))
    .sort((a, b) => a.value - b.value);
}

function isConsecutive(groups: readonly RankGroup[]): boolean {
  if (groups.some((group) => group.value > MAX_CHAIN_RANK_VALUE)) {
    return false;
  }

  for (let i = 1; i < groups.length; i += 1) {
    if (groups[i]!.value !== groups[i - 1]!.value + 1) {
      return false;
    }
  }

  return true;
}

function identifyStraight(cards: readonly Card[]): Combination | null {
  if (cards.length < 5) {
    return null;
  }

  const groups = getRankGroups(cards);
  if (groups.length !== cards.length || !isConsecutive(groups)) {
    return null;
  }

  return createCombination("straight", cards, groups.at(-1)!.rank, groups.length);
}

function identifyPairSequence(
  cards: readonly Card[],
  pairs: readonly RankGroup[],
  groups: readonly RankGroup[]
): Combination | null {
  if (cards.length < 6 || cards.length % 2 !== 0) {
    return null;
  }

  if (groups.length !== pairs.length || pairs.length < 3 || !isConsecutive(pairs)) {
    return null;
  }

  return createCombination("pair_sequence", cards, pairs.at(-1)!.rank, pairs.length);
}

function identifyPlane(
  cards: readonly Card[],
  trios: readonly RankGroup[],
  singles: readonly RankGroup[],
  pairs: readonly RankGroup[],
  groups: readonly RankGroup[]
): Combination | null {
  if (trios.length < 2 || !isConsecutive(trios)) {
    return null;
  }

  const trioCardsLength = trios.length * 3;
  const wingLength = cards.length - trioCardsLength;
  const mainRank = trios.at(-1)!.rank;

  if (wingLength === 0 && groups.length === trios.length) {
    return createCombination("plane", cards, mainRank, trios.length);
  }

  if (wingLength === trios.length && singles.length === trios.length && !wingsSplitRocket(singles)) {
    return createCombination("plane_with_singles", cards, mainRank, trios.length);
  }

  if (wingLength === trios.length * 2 && pairs.length === trios.length) {
    return createCombination("plane_with_pairs", cards, mainRank, trios.length);
  }

  return null;
}
