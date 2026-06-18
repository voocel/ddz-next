import { CHAIN_RANKS, getRankValue } from "@ddz/domain";
import type { Card, Rank } from "@ddz/domain";

/**
 * 规则机器人的叫/抢地主启发式:给手牌打分,过阈值才叫/抢。
 * 纯函数、只看自己手牌(无对手/局势感知);出牌策略见 @ddz/domain 的 decideBotPlay。
 * LLM bot 在实验期也复用这套叫抢策略(隔离变量,只验证其出牌能力)。
 */
export function shouldCallLandlord(hand: readonly Card[]): boolean {
  return scoreHand(hand) >= 18;
}

export function shouldRobLandlord(hand: readonly Card[]): boolean {
  return scoreHand(hand) >= 22;
}

function scoreHand(hand: readonly Card[]): number {
  const counts = countRanks(hand);
  let score = 0;

  if (counts.get("SJ") && counts.get("BJ")) {
    score += 8;
  }

  for (const [rank, count] of counts) {
    if (count === 4) {
      score += 7;
    } else if (count === 3) {
      score += 4;
    } else if (count === 2 && getRankValue(rank) >= getRankValue("A")) {
      score += 2;
    }

    if (rank === "BJ") {
      score += 5;
    } else if (rank === "SJ") {
      score += 4;
    } else if (rank === "2") {
      score += count * 3;
    } else if (rank === "A") {
      score += count * 2;
    } else if (rank === "K") {
      score += count;
    }
  }

  score += scoreChains(counts);
  return score;
}

function countRanks(hand: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of hand) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

function scoreChains(counts: ReadonlyMap<Rank, number>): number {
  let longestSingleChain = 0;
  let longestPairChain = 0;
  let longestTrioChain = 0;
  let currentSingle = 0;
  let currentPair = 0;
  let currentTrio = 0;

  for (const rank of CHAIN_RANKS) {
    const count = counts.get(rank) ?? 0;
    currentSingle = count >= 1 ? currentSingle + 1 : 0;
    currentPair = count >= 2 ? currentPair + 1 : 0;
    currentTrio = count >= 3 ? currentTrio + 1 : 0;
    longestSingleChain = Math.max(longestSingleChain, currentSingle);
    longestPairChain = Math.max(longestPairChain, currentPair);
    longestTrioChain = Math.max(longestTrioChain, currentTrio);
  }

  return Math.max(0, longestSingleChain - 4) + Math.max(0, longestPairChain - 2) * 2 + Math.max(0, longestTrioChain - 1) * 3;
}
