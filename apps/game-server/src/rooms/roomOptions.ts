import { decisionConfigFromEnv, isAllowedModel, type BotProviderRegistry, type ModelRef } from "@ddz/bot-ai";
import { ROOM_CODE_REGEX } from "@ddz/protocol";

/**
 * 建房 options 与环境变量的校验型 reader(纯函数,零状态)。
 * 客户端传入的 options 一律视为不可信输入:非法即抛错拒绝,不做静默修正/回退。
 */

export const DEFAULT_TURN_TIMEOUT_MS = 20_000;
// 大模型机器人展示倒计时默认值:比真人(20s)长,留出推理时间;到点不兜底,可停在 0 继续等模型。
export const DEFAULT_LLM_BOT_TURN_TIMER_MS = 30_000;
const DEFAULT_ROOM_CLAIM_TTL_MS = 60_000;
export const QUICK_START_BOT_COUNT = 2;

export function readRoomCode(options: { roomCode?: unknown }): string {
  return parseRoomCode(options.roomCode);
}

export function readTurnTimeoutMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TURN_TIMEOUT_MS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Turn timeout must be a positive integer in milliseconds.");
  }
  return value;
}

export function readLlmBotTurnTimerMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LLM_BOT_TURN_TIMER_MS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("LLM bot turn timer must be a positive integer in milliseconds.");
  }
  return value;
}

export function readRoomClaimTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ROOM_CLAIM_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_ROOM_CLAIM_TTL_MS;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 5_000 || value > 30 * 60_000) {
    throw new Error("ROOM_CLAIM_TTL_MS must be an integer between 5000 and 1800000 milliseconds.");
  }
  return value;
}

export function roomClaimHeartbeatIntervalMs(claimTtlMs: number): number {
  return Math.floor(claimTtlMs / 2);
}

export function usesLlmBotDecision(
  options: { botDecisionMode?: string },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (options.botDecisionMode === "llm") {
    return true;
  }
  if (options.botDecisionMode === "rule") {
    return false;
  }
  return decisionConfigFromEnv(env).useLlm;
}

export function readBotCount(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error("Bot count must be an integer between 0 and 2.");
  }
  return value;
}

export function readQuickStart(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error("Quick start must be a boolean.");
  }
  return value;
}

export function readArena(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error("Arena flag must be a boolean.");
  }
  return value;
}

export function readSpectate(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error("Spectate flag must be a boolean.");
  }
  return value;
}

/** 阵容(不可信输入):恰好 seats 个 {provider, model}(竞技场 3 席/挑战桌 2 席),逐项经注册表校验,非法即拒绝建房(不回退默认)。 */
export function readLineup(value: unknown, registry: BotProviderRegistry, seats: 2 | 3): ModelRef[] {
  if (!Array.isArray(value) || value.length !== seats) {
    throw new Error(`建房必须提供 lineup: 恰好 ${seats} 个 {provider, model}。`);
  }
  return value.map((entry, index) => {
    const seat = index + 1;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`阵容第 ${seat} 席必须是 {provider, model} 对象。`);
    }
    const { provider, model } = entry as Record<string, unknown>;
    if (typeof provider !== "string" || !provider.trim() || typeof model !== "string" || !model.trim()) {
      throw new Error(`阵容第 ${seat} 席的 provider/model 必须是非空字符串。`);
    }
    const ref: ModelRef = { provider, model };
    if (!isAllowedModel(registry, ref)) {
      throw new Error(`阵容第 ${seat} 席 ${provider}/${model} 不在服务端允许的模型列表中——已拒绝建房。`);
    }
    return ref;
  });
}

/** lineup 席位 bot 昵称直接用模型名;同模型对打时追加 #2/#3 以区分席位。 */
export function lineupBotNicknames(lineup: readonly ModelRef[]): string[] {
  const counts = new Map<string, number>();
  return lineup.map((ref) => {
    const seen = (counts.get(ref.model) ?? 0) + 1;
    counts.set(ref.model, seen);
    return seen === 1 ? ref.model : `${ref.model}#${seen}`;
  });
}

export function readArenaMaxSpectators(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARENA_MAX_SPECTATORS?.trim();
  if (!raw) {
    return 20;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new Error("ARENA_MAX_SPECTATORS must be an integer between 0 and 1000.");
  }
  return value;
}

export function readArenaIntermissionMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARENA_INTERMISSION_MS?.trim();
  if (!raw) {
    return 15_000;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000 || value > 10 * 60_000) {
    throw new Error("ARENA_INTERMISSION_MS must be an integer between 1000 and 600000 milliseconds.");
  }
  return value;
}

export function readArenaMaxRounds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARENA_MAX_ROUNDS?.trim();
  if (!raw) {
    return 12;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error("ARENA_MAX_ROUNDS must be an integer between 1 and 1000.");
  }
  return value;
}

export function readBotRetryMaxAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BOT_RETRY_MAX_ATTEMPTS?.trim();
  if (!raw) {
    return 3;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("BOT_RETRY_MAX_ATTEMPTS must be an integer between 1 and 10.");
  }
  return value;
}

export function readFixedBotDelayMs(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Bot move delay must be a non-negative integer in milliseconds.");
  }
  return value;
}

export function parseRoomCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Room code is required to join the game room.");
  }

  // 严格校验：只接受规范格式（6 位数字），不做 trim 之类的静默修正
  if (!ROOM_CODE_REGEX.test(value)) {
    throw new Error("Room code must be 6 digits.");
  }

  return value;
}

/** 环境变量层的思考档位显式指定;供「客户端与 env 均未指定时竞技场默认 medium」的判断使用。 */
export function readEnvBotReasoningEffort(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.BOT_REASONING_EFFORT;
}
