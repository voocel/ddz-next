import type { GameEvent } from "@ddz/protocol";

/** bot_ai_stream 事件(从 GameEvent 联合里取出该分支),供 reducer 形参标注。 */
type BotAiStreamEvent = Extract<GameEvent, { type: "bot_ai_stream" }>;
type BotDecisionFailedEvent = Extract<GameEvent, { type: "bot_decision_failed" }>;

export type BotAiStreamChannel = "reasoning" | "text";

export type BotAiChoice = NonNullable<BotAiStreamEvent["choice"]>;

export interface BotThinkingError {
  readonly message: string;
  readonly retryable: boolean;
}

/** 单个机器人的 AI 输出流状态:按 channel 累积文本 + 是否仍在输出。 */
export interface BotThinkingEntry {
  readonly channels: Readonly<Record<BotAiStreamChannel, string>>;
  /** 成功解析出的最终编号及其候选动作说明;有它时折叠态优先展示具体动作而不是裸数字。 */
  readonly choice?: BotAiChoice;
  /** 本手 LLM 决策失败的可见错误;由用户在同一 AI 面板里手动重试。 */
  readonly error?: BotThinkingError;
  /** true=正在输出(气泡脉冲);false=本手已收尾(done),文本冻结保留供回看。 */
  readonly active: boolean;
}

/** 按 playerId 归集的 AI 输出流状态(供牌桌按座位渲染气泡)。 */
export type BotThinkingState = Readonly<Record<string, BotThinkingEntry>>;

export const EMPTY_THINKING: BotThinkingState = {};

const EMPTY_CHANNELS: Readonly<Record<BotAiStreamChannel, string>> = { reasoning: "", text: "" };

/**
 * 把一个 bot_ai_stream 事件并入输出状态(纯函数,供 useDdzApp reducer 与单测复用):
 * - done=false:上轮已收尾(active=false)或不存在 → 新一轮,从空开始追加;否则在原文本上追加。
 * - done=true:追加剩余片段并冻结(active=false),文本保留;下一轮该 bot 新增量到来时再覆盖。
 * 服务端只在本手确有 reasoning/text 增量时才发事件。
 */
export function reduceThinking(state: BotThinkingState, event: BotAiStreamEvent): BotThinkingState {
  const prev = state[event.playerId];
  const baseChannels = event.done
    ? (prev?.channels ?? EMPTY_CHANNELS)
    : prev?.active
      ? prev.channels
      : EMPTY_CHANNELS;
  const channels = {
    ...baseChannels,
    [event.channel]: baseChannels[event.channel] + event.text
  };
  const choice = event.choice ?? (event.done ? prev?.choice : prev?.active ? prev.choice : undefined);
  const error = event.done ? prev?.error : prev?.active ? prev.error : undefined;
  const next = {
    channels,
    ...(choice ? { choice } : {}),
    ...(error ? { error } : {})
  };
  if (event.done) {
    return { ...state, [event.playerId]: { ...next, active: false } };
  }
  return { ...state, [event.playerId]: { ...next, active: true } };
}

export function reduceBotDecisionFailed(state: BotThinkingState, event: BotDecisionFailedEvent): BotThinkingState {
  const prev = state[event.playerId];
  return {
    ...state,
    [event.playerId]: {
      channels: prev?.channels ?? EMPTY_CHANNELS,
      ...(prev?.choice ? { choice: prev.choice } : {}),
      error: {
        message: event.message,
        retryable: event.retryable
      },
      active: false
    }
  };
}

export function hasBotAiStreamText(entry: BotThinkingEntry): boolean {
  return (
    entry.active ||
    Boolean(entry.choice) ||
    Boolean(entry.error) ||
    entry.channels.reasoning.length > 0 ||
    entry.channels.text.length > 0
  );
}
