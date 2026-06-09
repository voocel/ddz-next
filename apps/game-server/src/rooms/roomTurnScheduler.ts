import type { GameSnapshot, PlayerId } from "@ddz/domain";

interface TimerHandle {
  clear(): void;
}

interface RoomClock {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
}

interface TurnTimerEvent {
  readonly deadlineAt: string;
  readonly durationMs: number;
  readonly playerId: PlayerId;
  readonly snapshot: GameSnapshot;
}

interface RoomTurnSchedulerOptions {
  readonly botIds: readonly PlayerId[];
  readonly botMoveDelayMs: number;
  readonly clock: RoomClock;
  readonly enqueue: (task: () => Promise<void>) => void;
  readonly onBotTurn: (playerId: PlayerId) => Promise<void>;
  readonly onFailure: (error: unknown, reason: string) => Promise<void>;
  readonly onTurnTimeout: (playerId: PlayerId) => Promise<void>;
  readonly onTurnTimer: (event: TurnTimerEvent) => void;
  readonly turnTimeoutMs: number;
}

export class RoomTurnScheduler {
  private botTimer: TimerHandle | null = null;
  private botTimerToken = 0;
  private turnTimer: TimerHandle | null = null;
  private turnTimerToken = 0;

  constructor(private readonly options: RoomTurnSchedulerOptions) {}

  scheduleBotTurn(snapshot: GameSnapshot): void {
    this.cancelBotTimer();
    if (!snapshot.currentPlayerId || !this.options.botIds.includes(snapshot.currentPlayerId)) {
      return;
    }

    const playerId = snapshot.currentPlayerId;
    const token = this.botTimerToken + 1;
    this.botTimerToken = token;
    this.botTimer = this.options.clock.setTimeout(() => {
      if (this.botTimerToken !== token) {
        return;
      }

      this.botTimer = null;
      this.enqueueScheduledTask(() => this.options.onBotTurn(playerId), "Bot action failed.");
    }, this.options.botMoveDelayMs);
  }

  scheduleTurnTimer(snapshot: GameSnapshot): void {
    this.cancelTurnTimer();

    if (!snapshot.currentPlayerId || snapshot.phase === "waiting" || snapshot.phase === "ready" || snapshot.phase === "settled") {
      return;
    }

    const playerId = snapshot.currentPlayerId;
    const token = this.turnTimerToken + 1;
    this.turnTimerToken = token;
    const deadlineAt = new Date(Date.now() + this.options.turnTimeoutMs).toISOString();

    this.options.onTurnTimer({
      playerId,
      deadlineAt,
      durationMs: this.options.turnTimeoutMs,
      snapshot
    });

    this.turnTimer = this.options.clock.setTimeout(() => {
      if (this.turnTimerToken !== token) {
        return;
      }

      this.turnTimer = null;
      this.enqueueScheduledTask(() => this.options.onTurnTimeout(playerId), "Turn timeout failed.");
    }, this.options.turnTimeoutMs);
  }

  cancelAll(): void {
    this.cancelBotTimer();
    this.cancelTurnTimer();
  }

  private cancelBotTimer(): void {
    this.botTimerToken += 1;
    this.botTimer?.clear();
    this.botTimer = null;
  }

  private cancelTurnTimer(): void {
    this.turnTimerToken += 1;
    this.turnTimer?.clear();
    this.turnTimer = null;
  }

  private enqueueScheduledTask(task: () => Promise<void>, failureReason: string): void {
    this.options.enqueue(async () => {
      try {
        await task();
      } catch (error) {
        await this.options.onFailure(error, failureReason);
      }
    });
  }
}
