import { useEffect, useRef } from "react";

import type { TurnTimerState } from "./types";

/** 本地玩家回合剩余时间低于此阈值时提醒一次 */
const ALARM_THRESHOLD_MS = 5000;

/**
 * 本地玩家回合剩余时间首次跌破阈值时触发一次超时提醒。
 * 按 deadlineAt 标记“本回合已响过”，每个新回合自动重新武装；非本地回合不响。
 */
export function useTurnAlarm(
  turnTimer: TurnTimerState | null,
  localPlayerId: string,
  onAlarm: () => void
): void {
  const firedFor = useRef<string | null>(null);
  const isLocalTurn = turnTimer != null && turnTimer.playerId === localPlayerId;
  const deadlineAt = isLocalTurn ? turnTimer.deadlineAt : null;
  const remainingMs = turnTimer?.remainingMs ?? Infinity;

  useEffect(() => {
    if (deadlineAt == null) {
      return;
    }
    if (remainingMs > 0 && remainingMs <= ALARM_THRESHOLD_MS && firedFor.current !== deadlineAt) {
      firedFor.current = deadlineAt;
      onAlarm();
    }
  }, [deadlineAt, remainingMs, onAlarm]);
}
