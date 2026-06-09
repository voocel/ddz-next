import { suggestPlay } from "@ddz/domain";
import type { Card, CardId, GameSnapshot, PlayerId } from "@ddz/domain";

export type TimeoutAction =
  | {
      readonly type: "bid_landlord";
      readonly called: false;
    }
  | {
      readonly type: "rob_landlord";
      readonly robbed: false;
    }
  | {
      readonly type: "pass";
    }
  | {
      readonly type: "play_cards";
      readonly cards: readonly CardId[];
    };

export function decideTimeoutAction(snapshot: GameSnapshot, playerId: PlayerId, hand: readonly Card[]): TimeoutAction {
  switch (snapshot.phase) {
    case "bidding":
      assertActivePlayer(snapshot, playerId);
      return {
        type: "bid_landlord",
        called: false
      };
    case "robbing":
      assertActivePlayer(snapshot, playerId);
      return {
        type: "rob_landlord",
        robbed: false
      };
    case "playing":
      assertActivePlayer(snapshot, playerId);
      if (snapshot.lastPlay) {
        return {
          type: "pass"
        };
      }

      return {
        type: "play_cards",
        cards: readTimeoutPlay(hand)
      };
    case "ready":
    case "settled":
    case "waiting":
      throw new Error(`Cannot decide timeout action during ${snapshot.phase} phase.`);
  }
}

function assertActivePlayer(snapshot: GameSnapshot, playerId: PlayerId): void {
  if (snapshot.currentPlayerId !== playerId) {
    throw new Error(`Cannot decide timeout action for inactive player ${playerId}.`);
  }
}

function readTimeoutPlay(hand: readonly Card[]): readonly CardId[] {
  const suggestion = suggestPlay(hand, null);
  if (!suggestion) {
    throw new Error("No legal timeout play is available.");
  }

  return suggestion.map((card) => card.id);
}
