import type { GameSnapshot } from "@ddz/domain";

interface DelayRange {
  readonly minMs: number;
  readonly maxMs: number;
}

// “从容”档:机器人按情境模拟真人思考,时长带随机抖动(单位 ms)。
// 顺序刻意拉开:自由领出选择最多、想得最久 > 跟牌/过牌 > 叫/抢只是一个短停顿。
const BID_DELAY: DelayRange = { minMs: 1200, maxMs: 2200 };
const LEAD_PLAY_DELAY: DelayRange = { minMs: 2000, maxMs: 3500 };
const FOLLOW_PLAY_DELAY: DelayRange = { minMs: 1500, maxMs: 2800 };

/**
 * 机器人本回合的“思考”延迟:仅依据公开快照(相位 + 是否自由领出)选区间并加随机抖动。
 * random 可注入以便确定性单测,与 @ddz/domain 的 shuffleDeck 一致。
 */
export function botTurnDelayMs(snapshot: GameSnapshot, random: () => number = Math.random): number {
  const range = selectRange(snapshot);
  const span = range.maxMs - range.minMs;
  return range.minMs + Math.floor(random() * (span + 1));
}

function selectRange(snapshot: GameSnapshot): DelayRange {
  switch (snapshot.phase) {
    case "bidding":
    case "robbing":
      return BID_DELAY;
    case "playing":
      // lastPlay 为空 = 自由领出(开局/一圈过完),选择空间最大;否则是跟牌或过牌
      return snapshot.lastPlay === null ? LEAD_PLAY_DELAY : FOLLOW_PLAY_DELAY;
    default:
      // waiting/ready/settled 不会调度 bot 回合,兜底取跟牌区间
      return FOLLOW_PLAY_DELAY;
  }
}
