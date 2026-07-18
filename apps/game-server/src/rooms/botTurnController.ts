import type { GameSnapshot, GameTable, PlayerId } from "@ddz/domain";
import type { GameEvent, GameSnapshotDto } from "@ddz/protocol";
import type { BotAction, BotBrain } from "./botBrain.js";
import { LlmDecisionError } from "./llmBotBrain.js";
import type { RoomClock } from "./roomTurnScheduler.js";

// LLM 决策失败自动重试:指数退避基数(2s→4s→8s...),上限由 BOT_RETRY_MAX_ATTEMPTS 收口。
const BOT_RETRY_BACKOFF_BASE_MS = 2000;

interface PendingBotDecisionFailure {
  readonly playerId: PlayerId;
  readonly message: string;
  /** 本回合第几次失败(1 基),重连补发时保持一致。 */
  readonly attempt: number;
  /** true 表示已安排自动重试。 */
  readonly willRetry: boolean;
}

interface BotTurnControllerOptions {
  /** 仅日志前缀,与房间日志同源可 grep。 */
  readonly roomCode: string;
  /** 只读用法:snapshot/getHand/playedCards/history。 */
  readonly table: GameTable;
  /** 大脑注册表留在房间(写者是房间生命周期逻辑),按 playerId 取脑。 */
  readonly brainFor: (playerId: PlayerId) => BotBrain | undefined;
  readonly retryMaxAttempts: number;
  readonly clock: RoomClock;
  /** 原样 tasks.enqueue:必须回传 Promise(apply 路径要 await);不得复用 scheduler options 里的 void+failed 包装。 */
  readonly enqueue: (task: () => Promise<void>) => Promise<void>;
  readonly isFailed: () => boolean;
  readonly broadcast: (event: GameEvent) => void;
  readonly toSnapshotDto: (snapshot: GameSnapshot) => GameSnapshotDto;
  /** 重试重启时把回合倒计时重置为满额。 */
  readonly scheduleTurnTimer: (snapshot: GameSnapshot) => void;
  /** 锁内应用权威动作(房间的 applyBotAction:纯动作分发 + 落库 + 广播)。 */
  readonly onApplyAction: (playerId: PlayerId, action: BotAction) => Promise<void>;
  /** 重试耗尽出口:竞技场传流局闭包(入队+失败兜底在房间侧),真人房传 null=等待手动重试;同时决定日志文案分支。 */
  readonly onRetriesExhausted: ((playerId: PlayerId, message: string) => void) | null;
  readonly onFailure: (error: unknown, reason: string) => Promise<void>;
  /** 决策收尾(成功/抛错都触发):收尾本手 AI 输出流(flush 剩余片段 + done,清缓冲)。 */
  readonly onDecisionSettled: (playerId: PlayerId) => void;
}

/**
 * bot 回合执行 + LLM 失败/退避重试状态机,「锁外决策→锁内应用」并发契约的唯一属主:
 * brain.decide 绝不进串行队列(LLM 卡整房是头号红线),失败态变更全程锁外同步,
 * 应用动作经 enqueue 回锁内并三连再校验;迟到的退避定时器靠四连守卫自然失效。
 */
export class BotTurnController {
  private pendingFailure: PendingBotDecisionFailure | null = null;
  private readonly retryAttempts = new Map<PlayerId, number>();
  private readonly inFlight = new Set<PlayerId>();

  constructor(private readonly options: BotTurnControllerOptions) {}

  async handleTurn(playerId: PlayerId, isValid: () => boolean): Promise<void> {
    // 锁外:只读快照决策(LLM 等慢速实现不持有串行锁,避免卡住整个房间)。
    const snapshot = this.options.table.snapshot();
    if (!isValid() || snapshot.currentPlayerId !== playerId) {
      return;
    }
    if (this.pendingFailure?.playerId === playerId || this.inFlight.has(playerId)) {
      return;
    }

    const brain = this.options.brainFor(playerId);
    if (!brain) {
      throw new Error(`No bot brain registered for ${playerId}.`);
    }

    let action: BotAction;
    this.inFlight.add(playerId);
    try {
      action = await brain.decide(
        snapshot,
        playerId,
        this.options.table.getHand(playerId),
        this.options.table.playedCards(),
        this.options.table.history()
      );
    } catch (error) {
      if (error instanceof LlmDecisionError) {
        this.handleFailure(playerId, error);
        return;
      }
      // 非 LLM 决策错误继续冒出:scheduler 的 runBotTurn 捕获后 failRoom
      throw error;
    } finally {
      this.inFlight.delete(playerId);
      // 无论决策成功/抛错(失败将关房),都收尾本手 AI 输出流:flush 剩余片段 + done,清缓冲。
      this.options.onDecisionSettled(playerId);
    }

    // 锁内:应用权威动作 + 落库 + 广播。await 期间局面可能已推进,入队后再校验一次。
    await this.options.enqueue(async () => {
      if (this.options.isFailed() || !isValid() || this.options.table.snapshot().currentPlayerId !== playerId) {
        return;
      }
      if (this.pendingFailure?.playerId === playerId) {
        this.pendingFailure = null;
      }
      // 决策成功落地,本回合失败计数清零
      this.retryAttempts.delete(playerId);
      await this.options.onApplyAction(playerId, action);
    });
  }

  /** 真人显式重试(发起者是真人由房间校验);抛出的中文错误随 command_rejected 回给客户端。 */
  retryManually(): void {
    const pending = this.pendingFailure;
    if (!pending) {
      throw new Error("当前没有可重试的 AI 出牌错误。");
    }
    const snapshot = this.options.table.snapshot();
    if (snapshot.currentPlayerId !== pending.playerId) {
      this.pendingFailure = null;
      throw new Error("AI 回合已经变化，不能重试上一手错误。");
    }
    if (this.inFlight.has(pending.playerId)) {
      throw new Error("AI 正在重新请求中。");
    }

    // 手动重试重置自动重试计数:用户显式介入后重新给满退避额度
    this.retryAttempts.delete(pending.playerId);
    this.restart(pending.playerId);
  }

  /** 流局清态(abortRound 语义):pending 无条件清 + 该 bot 的失败计数删除。 */
  clearRetryState(playerId: PlayerId): void {
    this.pendingFailure = null;
    this.retryAttempts.delete(playerId);
  }

  /** 重连补发用的待重试失败事件;回合已变化则清掉过期标记并返回 null。 */
  pendingFailureEvent(): GameEvent | null {
    const pending = this.pendingFailure;
    if (!pending) {
      return null;
    }
    const snapshot = this.options.table.snapshot();
    if (snapshot.currentPlayerId !== pending.playerId) {
      this.pendingFailure = null;
      return null;
    }

    return {
      type: "bot_decision_failed",
      playerId: pending.playerId,
      message: pending.message,
      retryable: true,
      attempt: pending.attempt,
      willRetry: pending.willRetry,
      snapshot: this.options.toSnapshotDto(snapshot)
    } satisfies GameEvent;
  }

  /** 失败处理全程锁外同步执行(运行在 handleTurn 的锁外上下文)。 */
  private handleFailure(playerId: PlayerId, error: LlmDecisionError): void {
    if (this.options.isFailed()) {
      return;
    }
    const snapshot = this.options.table.snapshot();
    if (snapshot.currentPlayerId !== playerId) {
      return;
    }

    const attempt = (this.retryAttempts.get(playerId) ?? 0) + 1;
    this.retryAttempts.set(playerId, attempt);
    const willRetry = attempt < this.options.retryMaxAttempts;
    const message = error.message;
    this.pendingFailure = { playerId, message, attempt, willRetry };
    const nextStep = willRetry ? "auto retry scheduled" : this.options.onRetriesExhausted ? "aborting round" : "waiting for manual retry";
    console.error(
      `[DdzRoom ${this.options.roomCode}] Bot decision failed (attempt ${attempt}/${this.options.retryMaxAttempts}); ${nextStep}.`,
      error
    );
    this.options.broadcast({
      type: "bot_decision_failed",
      playerId,
      message,
      retryable: true,
      attempt,
      willRetry,
      snapshot: this.options.toSnapshotDto(snapshot)
    } satisfies GameEvent);

    if (willRetry) {
      // 指数退避自动重跑(2s→4s→...);全房型统一,真人房仍可手动抢先重试
      const backoffMs = BOT_RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      this.options.clock.setTimeout(() => this.autoRetry(playerId), backoffMs);
      return;
    }
    // 竞技场:流局(房内没有真人可手动重试);真人房(null):维持等待手动重试
    this.options.onRetriesExhausted?.(playerId, message);
  }

  /** 清除待重试标记并重新发起该 bot 的决策;手动重试与自动退避重试共用。 */
  private restart(playerId: PlayerId): void {
    this.pendingFailure = null;
    this.options.scheduleTurnTimer(this.options.table.snapshot());
    void this.handleTurn(playerId, () => this.options.table.snapshot().currentPlayerId === playerId).catch((error) => {
      void this.options.onFailure(error, "Bot retry failed.");
    });
  }

  /** 退避定时器到点的自动重试:房间失败/局面已变化/手动已抢先重试时直接放弃。 */
  private autoRetry(playerId: PlayerId): void {
    if (this.options.isFailed()) {
      return;
    }
    const pending = this.pendingFailure;
    if (!pending || pending.playerId !== playerId) {
      return;
    }
    if (this.options.table.snapshot().currentPlayerId !== playerId || this.inFlight.has(playerId)) {
      return;
    }
    this.restart(playerId);
  }
}
