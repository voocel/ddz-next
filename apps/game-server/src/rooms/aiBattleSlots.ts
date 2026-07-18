/**
 * AI 对战房(LLM 决策房与竞技场共用)的进程级容量闸门。
 * 单进程计数即可——跨进程互斥由 API RoomClaim 租约保证。
 */
let activeAiBattleRooms = 0;

export function reserveAiBattleSlot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.AI_BATTLE_ENABLED !== "true") {
    throw new Error("AI 对战当前未开启。请设置 AI_BATTLE_ENABLED=true 后重试。");
  }

  const maxActive = readAiBattleMaxActive(env);
  if (activeAiBattleRooms >= maxActive) {
    throw new Error(`AI 对战房间已达上限(${maxActive})，请稍后再试。`);
  }
  activeAiBattleRooms += 1;
}

export function releaseAiBattleSlot(): void {
  if (activeAiBattleRooms <= 0) {
    throw new Error("AI battle slot release underflow.");
  }
  activeAiBattleRooms -= 1;
}

function readAiBattleMaxActive(env: NodeJS.ProcessEnv): number {
  const raw = env.AI_BATTLE_MAX_ACTIVE?.trim();
  if (!raw) {
    return 1;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("AI_BATTLE_MAX_ACTIVE must be a positive integer.");
  }
  return parsed;
}
