import { decideBotPlay } from "@ddz/domain";
import type { BotPlayView, Card, GameSnapshot, PlayerId } from "@ddz/domain";
import type { BotAction, BotBrain } from "./botBrain.js";
import { shouldCallLandlord, shouldRobLandlord } from "./ruleBidding.js";

/** 现状规则机器人:同步纯函数决策包成 Promise,行为不变、确定性、可单测。 */
export class RuleBotBrain implements BotBrain {
  decide(
    snapshot: GameSnapshot,
    playerId: PlayerId,
    hand: readonly Card[],
    playedCards: readonly Card[]
  ): Promise<BotAction> {
    return Promise.resolve(decideBotAction(snapshot, playerId, hand, playedCards));
  }
}

export function decideBotAction(
  snapshot: GameSnapshot,
  playerId: PlayerId,
  hand: readonly Card[],
  playedCards: readonly Card[] = []
): BotAction {
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
      const landlordId = snapshot.landlordId;
      if (!landlordId) {
        throw new Error(`Cannot decide bot play before landlord is set for ${playerId}.`);
      }

      const view: BotPlayView = {
        hand,
        previous: snapshot.lastPlay?.combination ?? null,
        previousBy: snapshot.lastPlay?.playerId ?? null,
        selfId: playerId,
        landlordId,
        players: snapshot.players.map((player) => ({ id: player.id, handCount: player.handCount })),
        playedCards
      };

      const suggestion = decideBotPlay(view);
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
