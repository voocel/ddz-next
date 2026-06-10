import type { Card, Rank } from "./cards.js";
import { getRankValue, RANKS, sortCards } from "./cards.js";
import type { Combination } from "./combinations.js";
import { canBeat, identifyCombination } from "./combinations.js";

interface RankCards {
  readonly cards: readonly Card[];
  readonly count: number;
  readonly rank: Rank;
  readonly value: number;
}

const MAX_CHAIN_RANK_VALUE = getRankValue("A");
const CHAIN_RANKS = RANKS.filter((rank) => getRankValue(rank) <= MAX_CHAIN_RANK_VALUE);

export function suggestPlay(hand: readonly Card[], previous: Combination | null): readonly Card[] | null {
  if (hand.length === 0) {
    return null;
  }

  const groups = groupCardsByRank(hand);
  if (!previous) {
    return sortCards(takeCards(groups[0]!, 1), "asc");
  }

  if (previous.kind === "rocket") {
    return null;
  }

  const sameKind = suggestSameKind(groups, previous);
  if (sameKind) {
    return sameKind;
  }

  // previous 为炸弹时 suggestSameKind 已尝试过更大的炸弹，这里只处理非炸弹牌型。
  const bomb = previous.kind === "bomb" ? null : suggestBomb(groups, null);
  if (bomb) {
    return bomb;
  }

  return suggestRocket(groups);
}

function suggestSameKind(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  switch (previous.kind) {
    case "single":
      return validate(selectRepeated(groups, 1, previous.mainRank), previous);
    case "pair":
      return validate(selectRepeated(groups, 2, previous.mainRank), previous);
    case "trio":
      return validate(selectRepeated(groups, 3, previous.mainRank), previous);
    case "trio_with_single":
      return suggestTrioWithSingle(groups, previous);
    case "trio_with_pair":
      return suggestTrioWithPair(groups, previous);
    case "straight":
      return validate(selectSequence(groups, 1, previous.chainLength ?? 0, previous.mainRank), previous);
    case "pair_sequence":
      return validate(selectSequence(groups, 2, previous.chainLength ?? 0, previous.mainRank), previous);
    case "plane":
      return validate(selectSequence(groups, 3, previous.chainLength ?? 0, previous.mainRank), previous);
    case "plane_with_singles":
      return suggestPlaneWithSingles(groups, previous);
    case "plane_with_pairs":
      return suggestPlaneWithPairs(groups, previous);
    case "four_with_two_singles":
      return suggestFourWithTwoSingles(groups, previous);
    case "four_with_two_pairs":
      return suggestFourWithTwoPairs(groups, previous);
    case "bomb":
      return suggestBomb(groups, previous.mainRank);
    case "rocket":
      return null;
  }
}

function suggestTrioWithSingle(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const trio of repeatedCandidates(groups, 3, previous.mainRank)) {
    const wing = selectSingles(groups, 1, new Set([trio.rank]));
    const suggestion = wing ? validate([...takeCards(trio, 3), ...wing], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestTrioWithPair(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const trio of repeatedCandidates(groups, 3, previous.mainRank)) {
    const wing = selectPairs(groups, 1, new Set([trio.rank]));
    const suggestion = wing ? validate([...takeCards(trio, 3), ...wing], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestPlaneWithSingles(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const trios of sequenceCandidates(groups, 3, previous.chainLength ?? 0, previous.mainRank)) {
    const excluded = new Set(trios.map((group) => group.rank));
    const wings = selectSingles(groups, trios.length, excluded);
    const suggestion = wings ? validate([...trios.flatMap((group) => takeCards(group, 3)), ...wings], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestPlaneWithPairs(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const trios of sequenceCandidates(groups, 3, previous.chainLength ?? 0, previous.mainRank)) {
    const excluded = new Set(trios.map((group) => group.rank));
    const wings = selectPairs(groups, trios.length, excluded);
    const suggestion = wings ? validate([...trios.flatMap((group) => takeCards(group, 3)), ...wings], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestFourWithTwoSingles(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const quad of repeatedCandidates(groups, 4, previous.mainRank)) {
    const wings = selectSingles(groups, 2, new Set([quad.rank]));
    const suggestion = wings ? validate([...takeCards(quad, 4), ...wings], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestFourWithTwoPairs(groups: readonly RankCards[], previous: Combination): readonly Card[] | null {
  for (const quad of repeatedCandidates(groups, 4, previous.mainRank)) {
    const wings = selectPairs(groups, 2, new Set([quad.rank]));
    const suggestion = wings ? validate([...takeCards(quad, 4), ...wings], previous) : null;
    if (suggestion) {
      return suggestion;
    }
  }

  return null;
}

function suggestBomb(groups: readonly RankCards[], previousMainRank: Rank | null): readonly Card[] | null {
  const threshold = previousMainRank ? getRankValue(previousMainRank) : -1;
  const bomb = groups.find((group) => group.count >= 4 && group.value > threshold);
  return bomb ? sortCards(takeCards(bomb, 4), "asc") : null;
}

function suggestRocket(groups: readonly RankCards[]): readonly Card[] | null {
  const smallJoker = groups.find((group) => group.rank === "SJ")?.cards[0];
  const bigJoker = groups.find((group) => group.rank === "BJ")?.cards[0];
  return smallJoker && bigJoker ? [smallJoker, bigJoker] : null;
}

function selectRepeated(
  groups: readonly RankCards[],
  count: number,
  previousMainRank: Rank
): readonly Card[] | null {
  const group = repeatedCandidates(groups, count, previousMainRank)[0];
  return group ? takeCards(group, count) : null;
}

function repeatedCandidates(groups: readonly RankCards[], count: number, previousMainRank: Rank): readonly RankCards[] {
  const threshold = getRankValue(previousMainRank);
  const candidates = groups.filter((group) => group.count >= count && group.value > threshold);
  const nonBombCandidates = count < 4 ? candidates.filter((group) => group.count < 4) : candidates;
  return nonBombCandidates.length ? nonBombCandidates : candidates;
}

function selectSequence(
  groups: readonly RankCards[],
  countPerRank: number,
  chainLength: number,
  previousMainRank: Rank
): readonly Card[] | null {
  const sequence = sequenceCandidates(groups, countPerRank, chainLength, previousMainRank)[0];
  return sequence ? sequence.flatMap((group) => takeCards(group, countPerRank)) : null;
}

function sequenceCandidates(
  groups: readonly RankCards[],
  countPerRank: number,
  chainLength: number,
  previousMainRank: Rank
): readonly RankCards[][] {
  if (chainLength <= 0) {
    return [];
  }

  const byRank = new Map(groups.filter((group) => group.count >= countPerRank).map((group) => [group.rank, group]));
  const threshold = getRankValue(previousMainRank);
  const result: RankCards[][] = [];

  for (let start = 0; start <= CHAIN_RANKS.length - chainLength; start += 1) {
    const ranks = CHAIN_RANKS.slice(start, start + chainLength);
    const mainRank = ranks.at(-1);
    if (!mainRank || getRankValue(mainRank) <= threshold) {
      continue;
    }

    const sequence = ranks.map((rank) => byRank.get(rank));
    if (sequence.every((group): group is RankCards => group !== undefined)) {
      result.push(sequence);
    }
  }

  return result;
}

function selectSingles(
  groups: readonly RankCards[],
  count: number,
  excludedRanks: ReadonlySet<Rank>
): readonly Card[] | null {
  const candidates = groups
    .filter((group) => !excludedRanks.has(group.rank))
    .sort((a, b) => wingCost(a, 1) - wingCost(b, 1) || a.value - b.value);

  if (candidates.length < count) {
    return null;
  }

  const chosen = candidates.slice(0, count);
  // 双王不能同时作翼（等于拆火箭），用下一个非王候选替换大王。
  if (chosen.some((group) => group.rank === "SJ") && chosen.some((group) => group.rank === "BJ")) {
    const replacement = candidates.slice(count).find((group) => group.rank !== "SJ" && group.rank !== "BJ");
    if (!replacement) {
      return null;
    }
    chosen[chosen.findIndex((group) => group.rank === "BJ")] = replacement;
  }

  return chosen.map((group) => takeCards(group, 1)[0]!);
}

function selectPairs(
  groups: readonly RankCards[],
  count: number,
  excludedRanks: ReadonlySet<Rank>
): readonly Card[] | null {
  const candidates = groups
    .filter((group) => group.count >= 2 && !excludedRanks.has(group.rank))
    .sort((a, b) => wingCost(a, 2) - wingCost(b, 2) || a.value - b.value);

  if (candidates.length < count) {
    return null;
  }

  return candidates.slice(0, count).flatMap((group) => takeCards(group, 2));
}

function wingCost(group: RankCards, count: number): number {
  if (group.count === count) {
    return 0;
  }
  if (group.count < 4) {
    return 1;
  }
  return 2;
}

function validate(cards: readonly Card[] | null, previous: Combination): readonly Card[] | null {
  if (!cards) {
    return null;
  }

  const combination = identifyCombination(cards);
  if (!combination || !canBeat(combination, previous)) {
    return null;
  }

  return sortCards(combination.cards, "asc");
}

function takeCards(group: RankCards, count: number): Card[] {
  return sortCards(group.cards, "asc").slice(0, count);
}

function groupCardsByRank(cards: readonly Card[]): RankCards[] {
  const cardsByRank = new Map<Rank, Card[]>();
  for (const card of sortCards(cards, "asc")) {
    const group = cardsByRank.get(card.rank) ?? [];
    group.push(card);
    cardsByRank.set(card.rank, group);
  }

  return [...cardsByRank.entries()]
    .map(([rank, groupCards]) => ({
      cards: groupCards,
      count: groupCards.length,
      rank,
      value: getRankValue(rank)
    }))
    .sort((a, b) => a.value - b.value);
}
