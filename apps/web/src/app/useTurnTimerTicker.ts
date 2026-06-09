import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { TurnTimerState } from "./types";

export function useTurnTimerTicker(
  turnTimer: TurnTimerState | null,
  setTurnTimer: Dispatch<SetStateAction<TurnTimerState | null>>
): void {
  useEffect(() => {
    if (!turnTimer) {
      return;
    }

    const timer = window.setInterval(() => {
      setTurnTimer((current) => {
        if (!current) {
          return null;
        }
        return {
          ...current,
          remainingMs: Math.max(0, new Date(current.deadlineAt).getTime() - Date.now())
        };
      });
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [setTurnTimer, turnTimer]);
}
