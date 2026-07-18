import type { GameSnapshot, PlayerId } from "@ddz/domain";

export interface TimerHandle {
  clear(): void;
}

/** 房间时钟窄端口(Colyseus clock 的结构子集);兄弟协作者(arenaDirector/botTurnController)复用同一定义。 */
export interface RoomClock {
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
  /** 按当前快照算出本回合机器人的“思考”延迟(ms);随情境变化,故每次调度时计算 */
  readonly nextBotDelayMs: (snapshot: GameSnapshot) => number;
  readonly clock: RoomClock;
  readonly enqueue: (task: () => Promise<void>) => void;
  /** bot 回合在串行锁外触发;isValid 供应用动作前再校验本次调度是否仍生效。 */
  readonly onBotTurn: (playerId: PlayerId, isValid: () => boolean) => Promise<void>;
  readonly onFailure: (error: unknown, reason: string) => Promise<void>;
  readonly onTurnTimeout: (playerId: PlayerId) => Promise<void>;
  readonly onTurnTimer: (event: TurnTimerEvent) => void;
  readonly turnTimeoutMs: number;
  /** bot 回合的展示倒计时(ms):仅视觉,与真人一致;到点不安排兜底动作,bot 由自身决策驱动/超时收口。 */
  readonly botTurnTimerMs: number;
}

interface ActiveTurnTimer {
  readonly deadlineAt: string;
  readonly durationMs: number;
  readonly playerId: PlayerId;
}

export class RoomTurnScheduler {
  private botTimer: TimerHandle | null = null;
  private botTimerToken = 0;
  private turnTimer: TimerHandle | null = null;
  private turnTimerToken = 0;
  private activeTurnTimer: ActiveTurnTimer | null = null;

  constructor(private readonly options: RoomTurnSchedulerOptions) {}

  /** 当前生效的回合计时，供重连补发 turn_timer 使用。 */
  getActiveTurnTimer(): ActiveTurnTimer | null {
    return this.activeTurnTimer;
  }

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
      // bot 决策可能是慢速 LLM:在串行锁外执行(只读快照),由 onBotTurn 自行把「应用动作」入队。
      void this.runBotTurn(playerId, () => this.botTimerToken === token);
    }, this.options.nextBotDelayMs(snapshot));
  }

  scheduleTurnTimer(snapshot: GameSnapshot): void {
    this.cancelTurnTimer();

    if (!snapshot.currentPlayerId || snapshot.phase === "waiting" || snapshot.phase === "ready" || snapshot.phase === "settled") {
      return;
    }

    const playerId = snapshot.currentPlayerId;
    const isBot = this.options.botIds.includes(playerId);
    // bot 回合也广播倒计时,让牌桌表现与真人完全一致(同一个闹钟在转)。
    // 展示时长:bot 用 botTurnTimerMs(大模型更长),真人用 turnTimeoutMs。
    const durationMs = isBot ? this.options.botTurnTimerMs : this.options.turnTimeoutMs;
    const token = this.turnTimerToken + 1;
    this.turnTimerToken = token;
    const deadlineAt = new Date(Date.now() + durationMs).toISOString();
    this.activeTurnTimer = {
      playerId,
      deadlineAt,
      durationMs
    };

    this.options.onTurnTimer({
      playerId,
      deadlineAt,
      durationMs,
      snapshot
    });

    // bot 的倒计时纯视觉:绝不安排规则型超时兜底——动作由 scheduleBotTurn 驱动,
    // 大模型慢则倒计时停在 0 继续等,其真超时由自身 BOT_DECISION_TIMEOUT_MS 收口,
    // 不让规则动作替 bot 出牌(否则慢速 LLM 被静默顶替,污染纯 LLM 实验)。
    if (isBot) {
      return;
    }

    this.turnTimer = this.options.clock.setTimeout(() => {
      if (this.turnTimerToken !== token) {
        return;
      }

      this.turnTimer = null;
      this.enqueueScheduledTask(() => this.options.onTurnTimeout(playerId), "Turn timeout failed.", () => this.turnTimerToken === token);
    }, durationMs);
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
    this.activeTurnTimer = null;
  }

  private async runBotTurn(playerId: PlayerId, isValid: () => boolean): Promise<void> {
    // 触发时机已过期(回合推进/取消)直接放弃;onBotTurn 在锁外 await 决策,失败收口到房间。
    if (!isValid()) {
      return;
    }

    try {
      await this.options.onBotTurn(playerId, isValid);
    } catch (error) {
      await this.options.onFailure(error, "Bot action failed.");
    }
  }

  private enqueueScheduledTask(task: () => Promise<void>, failureReason: string, isStillValid: () => boolean): void {
    this.options.enqueue(async () => {
      // 任务真正执行时再校验一次 token：排队期间回合可能已推进，迟到的定时器直接放弃
      if (!isStillValid()) {
        return;
      }

      try {
        await task();
      } catch (error) {
        await this.options.onFailure(error, failureReason);
      }
    });
  }
}
