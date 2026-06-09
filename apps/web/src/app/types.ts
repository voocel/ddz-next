export type AuthMode = "login" | "register";

export interface TurnTimerState {
  readonly deadlineAt: string;
  readonly durationMs: number;
  readonly playerId: string;
  readonly remainingMs: number;
}
