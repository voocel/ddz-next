import type { ArenaCommentaryContext } from "@ddz/bot-ai";
import { identifyCombination } from "@ddz/domain";
import type { GameSnapshot, GameTable, PlayerId } from "@ddz/domain";
import type { GameEvent, GameSnapshotDto } from "@ddz/protocol";
import type { ArenaCommentaryDirector, ArenaCommentaryTag } from "./arenaCommentary.js";
import { describeCombination } from "./combinationLabels.js";
import type { RoomPersistence } from "./roomPersistence.js";
import type { RoomClock } from "./roomTurnScheduler.js";

// 连续流局达到该数即 failRoom 止损:挂掉的 API 不值得无限烧钱重试。
const ARENA_MAX_CONSECUTIVE_ABORTS = 2;

interface ArenaDirectorOptions {
  /** 仅日志前缀,与房间日志同源可 grep。 */
  readonly roomCode: string;
  readonly maxRounds: number;
  readonly intermissionMs: number;
  readonly commentary: ArenaCommentaryDirector;
  readonly table: GameTable;
  readonly clock: RoomClock;
  readonly enqueue: (task: () => Promise<void>) => Promise<void>;
  readonly isFailed: () => boolean;
  readonly nickname: (playerId: PlayerId) => string | undefined;
  readonly botModel: (playerId: PlayerId) => string | undefined;
  /** playerId → {provider, model},只含 LLM bot;流局落库 payload 用。 */
  readonly botPlayersPayload: () => Record<string, { provider: string; model: string }>;
  readonly recordMutation: RoomPersistence["recordMutation"];
  readonly broadcast: (event: GameEvent) => void;
  readonly toSnapshotDto: (snapshot: GameSnapshot) => GameSnapshotDto;
  /** turnScheduler.cancelAll(惰性闭包,构造顺序无关)。 */
  readonly cancelTimers: () => void;
  /** 流局清除失败 bot 的重试状态(pending 无条件清 + 计数删除)。 */
  readonly clearBotFailure: (playerId: PlayerId) => void;
  readonly readyBots: () => Promise<void>;
  /** 优雅关房落库(closed);房间侧同时复位 roomClaimed。 */
  readonly closeRoom: () => Promise<void>;
  readonly disconnect: () => void;
  readonly onFailure: (error: unknown, reason: string) => Promise<void>;
}

/**
 * 竞技场生命周期导演:流局/局间自动推进/打满 maxRounds 收官/连续流局止损 + 解说上下文装配。
 * 非竞技场房不存在该对象(DdzRoom.arenaDirector 为 null),`arenaDirector !== null` 即竞技场语义的唯一真相。
 * 局数与连败计数不随恢复信封落库:崩溃恢复后的竞技场获得全新局数额度与流局容忍度——既有行为,刻意保留。
 */
export class ArenaDirector {
  private roundsPlayed = 0;
  private consecutiveAborts = 0;

  constructor(private readonly options: ArenaDirectorOptions) {}

  /** 开局解说:首局是比赛开幕,续局报局数(计数不外泄给房间)。 */
  announceRoundStart(): void {
    this.fireCommentary(
      this.roundsPlayed === 0 ? "opening" : "round_start",
      this.roundsPlayed === 0
        ? "比赛开始!三位 AI 选手入座,第 1 局发牌完毕,进入叫地主阶段"
        : `第 ${this.roundsPlayed + 1} 局发牌完毕,进入叫地主阶段`
    );
  }

  /** 正常结算:重置连续流局计数并按局间节奏推进。 */
  onRoundSettled(): void {
    this.consecutiveAborts = 0;
    this.scheduleRoundTransition();
  }

  /** 触发一次竞技场解说;已失败时为空操作,节流与吞错由 commentary 导演收口。 */
  fireCommentary(tag: ArenaCommentaryTag, event: string): void {
    if (this.options.isFailed()) {
      return;
    }
    this.options.commentary.notify(tag, this.commentaryContext(event));
  }

  /**
   * 竞技场流局(串行队列内执行):LLM 决策耗尽重试后放弃本局——不伪造结算(保护 domain 零和不变量),
   * Round 以 round_aborted 收尾,技术负记到失败模型本人;连续流局达到上限即 failRoom 止损。
   */
  async abortRound(failedPlayerId: PlayerId, reason: string): Promise<void> {
    if (this.options.isFailed()) {
      return;
    }
    const phase = this.options.table.snapshot().phase;
    if (phase !== "bidding" && phase !== "robbing" && phase !== "playing") {
      // 迟到的流局任务(局面已被其他路径推进),放弃
      return;
    }

    const snapshot = this.options.table.abortRound();
    this.options.clearBotFailure(failedPlayerId);
    this.options.cancelTimers();
    const botPlayers = this.options.botPlayersPayload();
    await this.options.recordMutation({
      actions: [
        {
          type: "round_aborted",
          playerId: failedPlayerId,
          payload: {
            reason,
            failedPlayerId,
            players: snapshot.players.map((player) => ({ playerId: player.id, seat: player.seat })),
            ...(Object.keys(botPlayers).length > 0 ? { botPlayers } : {})
          }
        }
      ],
      snapshot
    });
    this.options.broadcast({
      type: "round_aborted",
      reason,
      failedPlayerId,
      snapshot: this.options.toSnapshotDto(snapshot)
    } satisfies GameEvent);

    this.consecutiveAborts += 1;
    if (this.consecutiveAborts >= ARENA_MAX_CONSECUTIVE_ABORTS) {
      await this.options.onFailure(new Error(`连续 ${this.consecutiveAborts} 局流局: ${reason}`), "Arena aborted repeatedly.");
      return;
    }
    this.scheduleRoundTransition();
  }

  /** 结算/流局后的推进:局间休息后自动开下一局;打满 maxRounds 后收官关房。 */
  scheduleRoundTransition(): void {
    if (this.options.isFailed()) {
      return;
    }
    this.roundsPlayed += 1;
    if (this.roundsPlayed >= this.options.maxRounds) {
      this.options.clock.setTimeout(() => {
        void this.options.enqueue(() => this.closeArena());
      }, this.options.intermissionMs);
      return;
    }
    this.options.clock.setTimeout(() => {
      void this.options.enqueue(() => this.startNextRound());
    }, this.options.intermissionMs);
  }

  private async startNextRound(): Promise<void> {
    if (this.options.isFailed()) {
      return;
    }
    const phase = this.options.table.snapshot().phase;
    if (phase === "settled") {
      this.options.table.resetForNextRound();
    } else if (phase !== "ready" && phase !== "waiting") {
      // 理论不可达:牌局已被其他路径推进,不强行重置
      return;
    }
    await this.options.readyBots();
  }

  /** 打满场次后的收官:优雅关房(closed 落库→断开全部连接),与 failRoom 的故障关房区分。 */
  private async closeArena(): Promise<void> {
    if (this.options.isFailed()) {
      return;
    }
    this.options.cancelTimers();
    try {
      await this.options.closeRoom();
    } catch (error) {
      console.error(`[DdzRoom ${this.options.roomCode}] Failed to close arena room.`, error);
    }
    // 与 failRoom 同理:不在串行队列内等待 disconnect(onLeave 同队列,等待会死锁);catch 在房间侧闭包内
    this.options.disconnect();
  }

  /** 把当前公开局面映射成解说上下文(席位/身份/剩牌/累计分 + 最近动作)。 */
  private commentaryContext(event: string): ArenaCommentaryContext {
    const snapshot = this.options.table.snapshot();
    return {
      seats: snapshot.players.map((player) => ({
        nickname: this.options.nickname(player.id) ?? player.id,
        model: this.options.botModel(player.id) ?? "",
        role:
          snapshot.landlordId === null ? "undecided" : snapshot.landlordId === player.id ? "landlord" : "farmer",
        handCount: player.handCount,
        score: player.score
      })),
      event,
      multiplier: snapshot.multiplier,
      recentActions: this.recentActionTexts(5)
    };
  }

  /** 最近几手的中文描述(带昵称),供解说 prompt 使用。 */
  private recentActionTexts(limit: number): string[] {
    return this.options.table
      .history()
      .slice(-limit)
      .map((entry) => {
        const name = this.options.nickname(entry.playerId) ?? entry.playerId;
        switch (entry.type) {
          case "play": {
            const combination = identifyCombination([...entry.cards]);
            return `${name} 出了${combination ? describeCombination(combination) : `${entry.cards.length} 张牌`}`;
          }
          case "pass":
            return `${name} 过牌`;
          case "bid":
            return `${name} ${entry.called ? "叫地主" : "不叫"}`;
          case "rob":
            return `${name} ${entry.robbed ? "抢地主" : "不抢"}`;
        }
      });
  }
}
