import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveRootPath } from "@ddz/env";
import type { LlmDecisionTrace } from "./llmBotBrain.js";

export interface LlmTraceSink {
  /** 记一次出牌决策(fire-and-forget,内部串行写,失败只告警)。 */
  record(trace: LlmDecisionTrace): void;
  /** 等所有挂起的写入落盘(房间 dispose 时调)。 */
  close(): Promise<void>;
}

const DEFAULT_TRACE_DIR = "logs/llm-traces";

/**
 * env 开关(BOT_DECISION_TRACE=true)下的 JSONL 决策留证 sink:每个房间一文件,一行一次决策,
 * 含完整游戏上下文/手牌/模型 IO/思考/用量/延迟/结局,供逐手排错与优化。
 * 未开启时返回 null(零开销、不落盘、对生产无副作用)。
 * 路径:BOT_TRACE_DIR(相对仓库根或绝对路径,默认 logs/llm-traces)/<roomCode>-<起始时间>.jsonl。
 * 写入用「尾 promise 链」串行化(防交错 + 首写前 mkdir -p),失败只 console.error——绝不拖垮房间。
 */
export function createLlmTraceSink(env: NodeJS.ProcessEnv, roomCode: string): LlmTraceSink | null {
  if (env.BOT_DECISION_TRACE !== "true") {
    return null;
  }

  const dir = resolveRootPath(env.BOT_TRACE_DIR?.trim() || DEFAULT_TRACE_DIR);
  const startedAt = new Date().toISOString();
  const file = join(dir, `${sanitize(roomCode)}-${sanitize(startedAt)}.jsonl`);
  let turn = 0;
  let tail: Promise<void> = mkdir(dir, { recursive: true }).then(() => undefined);

  return {
    record(trace) {
      const line = `${JSON.stringify({ ts: new Date().toISOString(), roomCode, turn: turn++, ...trace })}\n`;
      tail = tail
        .then(() => appendFile(file, line, "utf8"))
        .catch((error) => {
          console.error(`[llmTraceSink ${roomCode}] Failed to append decision trace.`, error);
        });
    },
    close() {
      return tail;
    }
  };
}

/** 文件名安全化:roomCode/时间戳里的非常规字符(冒号等)替成下划线。 */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
