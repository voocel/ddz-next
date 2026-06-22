import type { Card, CardId, GameSnapshot, PlayerId, PlayHistoryEntry } from "@ddz/domain";

/** 机器人决策出的一个动作:叫/抢地主、过牌、或出具体的牌。 */
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

/**
 * 机器人「大脑」契约:由公开快照 + 手牌决策出一个动作。
 * 规则 bot(ruleBotBrain.ts)与 LLM bot(llmBotBrain.ts)都实现它,房间/自博弈只依赖此接口,两种实现可热插拔。
 * decide 返回 Promise,使 LLM 等异步实现可接入;调用方须在锁外 await(决策只读,不改状态)。
 */
export interface BotBrain {
  decide(
    snapshot: GameSnapshot,
    playerId: PlayerId,
    hand: readonly Card[],
    playedCards: readonly Card[],
    history: readonly PlayHistoryEntry[]
  ): Promise<BotAction>;
}
