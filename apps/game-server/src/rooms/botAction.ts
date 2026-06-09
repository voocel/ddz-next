import { getRankValue, suggestPlay } from "@ddz/domain";
import type { Card, CardId, GameSnapshot, PlayerId, Rank } from "@ddz/domain";

export type BotAction =
  | {
      readonly type: "bid_landlord";
      readonly called: boolean;
    }
  | {
      readonly type: "rob_landlord";
      readonly robbed: boolean;
    }
  | {
      readonly type: "pass";
    }
  | {
      readonly type: "play_cards";
      readonly cards: readonly CardId[];
    };

export function decideBotAction(snapshot: GameSnapshot, playerId: PlayerId, hand: readonly Card[]): BotAction {
  const player = snapshot.players.find((item) => item.id === playerId);
  if (!player || player.kind !== "bot") {
    throw new Error(`Player ${playerId} is not a bot.`);
  }
  if (snapshot.currentPlayerId !== playerId) {
    throw new Error(`Cannot decide bot action for inactive player ${playerId}.`);
  }

  switch (snapshot.phase) {
    case "bidding":
      return {
        type: "bid_landlord",
        called: shouldCallLandlord(hand)
      };
    case "robbing":
      return {
        type: "rob_landlord",
        robbed: shouldRobLandlord(hand)
      };
    case "playing": {
      const suggestion = suggestPlay(hand, snapshot.lastPlay?.combination ?? null);
      if (!suggestion) {
        if (!snapshot.lastPlay) {
          throw new Error(`Bot ${playerId} has no legal lead play.`);
        }
        return {
          type: "pass"
        };
      }

      return {
        type: "play_cards",
        cards: suggestion.map((card) => card.id)
      };
    }
    case "ready":
    case "settled":
    case "waiting":
      throw new Error(`Cannot decide bot action during ${snapshot.phase} phase.`);
  }
}

function shouldCallLandlord(hand: readonly Card[]): boolean {
  return scoreHand(hand) >= 18;
}

function shouldRobLandlord(hand: readonly Card[]): boolean {
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
  const chainRanks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
  let longestSingleChain = 0;
  let longestPairChain = 0;
  let longestTrioChain = 0;
  let currentSingle = 0;
  let currentPair = 0;
  let currentTrio = 0;

  for (const rank of chainRanks) {
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
