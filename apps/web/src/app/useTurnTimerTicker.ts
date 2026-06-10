import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { TurnTimerState } from "./types";

export function useTurnTimerTicker(
  turnTimer: TurnTimerState | null,
  setTurnTimer: Dispatch<SetStateAction<TurnTimerState | null>>
): void {
  // 只依赖截止时间：每 250ms 刷新 remainingMs 不会重建 interval，归零后停表
  const deadlineAt = turnTimer?.deadlineAt ?? null;

  useEffect(() => {
    if (!deadlineAt) {
      return;
    }

    const deadline = new Date(deadlineAt).getTime();
    const timer = window.setInterval(() => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setTurnTimer((current) => {
        if (!current || current.deadlineAt !== deadlineAt) {
          return current;
        }
        return {
          ...current,
          remainingMs
        };
      });
      if (remainingMs <= 0) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [deadlineAt, setTurnTimer]);
}
