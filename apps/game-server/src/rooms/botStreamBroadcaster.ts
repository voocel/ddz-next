import type { PlayerId } from "@ddz/domain";
import type { GameEvent } from "@ddz/protocol";
import { takeThinkingChunk, type LlmDecisionChoice } from "./llmBotBrain.js";

// 大模型「AI 输出流」节流阈值:增量累积到约一短句(16 字)才广播一条,避免逐 token 的消息风暴。
const THINKING_MIN_CHARS = 16;

export type BotStreamChannel = "reasoning" | "text";
type BotStreamBuffers = Partial<Record<BotStreamChannel, string>> & {
  readonly choice?: LlmDecisionChoice;
  readonly emitted?: boolean;
};

interface BotStreamBroadcasterOptions {
  readonly broadcast: (event: GameEvent) => void;
  /** 房间失败后停止对外广播;end 仍照常清缓冲。 */
  readonly isFailed: () => boolean;
}

/**
 * AI 输出流:累积各 bot 的 reasoning/text 增量,按字数节流广播 bot_ai_stream(done:false)。
 * 全部方法在锁外回调(决策在锁外流式产出);只要 start/append 被调用过就留键,作为「本手产生过输出」的标记。
 */
export class BotStreamBroadcaster {
  private readonly buffers = new Map<PlayerId, BotStreamBuffers>();

  constructor(private readonly options: BotStreamBroadcasterOptions) {}

  start(playerId: PlayerId): void {
    if (this.options.isFailed()) {
      return;
    }
    this.buffers.set(playerId, { text: "", emitted: false });
    this.options.broadcast({
      type: "bot_ai_stream",
      playerId,
      channel: "text",
      text: "",
      done: false
    } satisfies GameEvent);
  }

  append(playerId: PlayerId, channel: BotStreamChannel, delta: string): void {
    if (this.options.isFailed()) {
      return;
    }
    const buffers = this.buffers.get(playerId) ?? {};
    const pending = (buffers[channel] ?? "") + delta;
    // 首个可见片段不节流:立即广播,让前端「开始思考」的反馈零延迟
    const firstVisibleChunk = !buffers.emitted && pending.trim().length > 0;
    const { chunk, rest } = firstVisibleChunk ? { chunk: pending, rest: "" } : takeThinkingChunk(pending, THINKING_MIN_CHARS);
    this.buffers.set(playerId, { ...buffers, [channel]: rest, emitted: buffers.emitted || chunk !== null });
    if (chunk !== null) {
      this.options.broadcast({
        type: "bot_ai_stream",
        playerId,
        channel,
        text: chunk,
        done: false
      } satisfies GameEvent);
    }
  }

  /** 记录本手 LLM 最终选择的候选动作;作为 AI 输出流的收尾元数据展示给前端。 */
  setChoice(playerId: PlayerId, choice: LlmDecisionChoice): void {
    if (this.options.isFailed()) {
      return;
    }
    const buffers = this.buffers.get(playerId) ?? {};
    this.buffers.set(playerId, { ...buffers, choice });
  }

  /** 收尾本手 AI 输出流:把剩余片段/最终选择连同 done:true 一并广播,清缓冲。本手没产生过输出(无键)则什么都不发。 */
  end(playerId: PlayerId): void {
    const buffers = this.buffers.get(playerId);
    if (!buffers) {
      return;
    }
    this.buffers.delete(playerId);
    if (this.options.isFailed()) {
      return;
    }
    let sent = false;
    for (const channel of ["reasoning", "text"] as const) {
      if (!(channel in buffers)) {
        continue;
      }
      this.options.broadcast({
        type: "bot_ai_stream",
        playerId,
        channel,
        text: buffers[channel] ?? "",
        done: true,
        ...(buffers.choice ? { choice: buffers.choice } : {})
      } satisfies GameEvent);
      sent = true;
    }
    if (!sent && buffers.choice) {
      this.options.broadcast({
        type: "bot_ai_stream",
        playerId,
        channel: "text",
        text: "",
        done: true,
        choice: buffers.choice
      } satisfies GameEvent);
    }
  }
}
