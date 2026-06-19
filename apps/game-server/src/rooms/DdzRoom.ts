import type { Client } from "@colyseus/core";
import { Room } from "@colyseus/core";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import {
  commentaryConfigFromEnv,
  LlmCommentator,
  NullCommentator,
  parseBotProviderRegistry,
  resolveModel,
  type BotProviderRegistry,
  type Commentator,
  type CommentaryContext
} from "@ddz/bot-ai";
import { GameTable } from "@ddz/domain";
import { clientCommandSchema, DUPLICATE_SESSION_CLOSE_CODE, ROOM_CODE_REGEX } from "@ddz/protocol";
import type { CardId, GameSnapshot, PlayerId, PublicPlay, ReadyResult } from "@ddz/domain";
import type { GameEvent, RoomLiveStateEnvelope } from "@ddz/protocol";
import type { GameActionClient } from "../api/gameActionClient.js";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { readPlayerKind, toCardsDto, toPublicPlayDto, toSettlementDto, toSnapshotDto } from "../dto.js";
import type { BotAction, BotBrain } from "./botBrain.js";
import { RuleBotBrain } from "./ruleBotBrain.js";
import { botTurnDelayMs } from "./botTiming.js";
import { pickBotNicknames } from "./botNames.js";
import { resolveBotBrain, type BotBrainHooks } from "./botDecision.js";
import { LlmBotBrain, takeThinkingChunk, type LlmDecisionChoice, type LlmDecisionTrace } from "./llmBotBrain.js";
import { createLlmTraceSink, type LlmTraceSink } from "./llmTraceSink.js";
import { combinationLabel } from "./combinationLabels.js";
import { RoomPersistence, RoomPersistenceError } from "./roomPersistence.js";
import { SerialTaskQueue } from "./serialTaskQueue.js";
import { RoomTurnScheduler } from "./roomTurnScheduler.js";
import { decideTimeoutAction } from "./timeoutAction.js";

interface JoinOptions {
  accessToken?: string;
  roomCode?: string;
  quickStart?: boolean;
}

interface RoomCreateOptions extends JoinOptions {
  roomStatusClient: RoomStatusClient;
  gameActionClient: GameActionClient;
  botCount?: number;
  matchBotCount?: number;
  /** 固定机器人延迟(ms)的测试/CI 逃生阀:设置则用此定值,不设置(undefined)则走 botTiming 的拟真区间 */
  botMoveDelayMs?: number | undefined;
  turnTimeoutMs?: number;
  /** 大模型机器人回合的展示倒计时(ms):仅视觉,到点不触发兜底,LLM 决策真超时由 BOT_DECISION_TIMEOUT_MS 收口。 */
  llmBotTurnTimerMs?: number;
  /** 客户端建房时选的机器人决策来源(rule|llm)与模型(provider+model);不可信,resolveBotBrain 校验后才生效。 */
  botDecisionMode?: string;
  botProvider?: string;
  botModel?: string;
  /** 客户端所选思考强度档位(auto|off|low|medium|high);不可信,resolveDecisionConfig 校验后才生效。 */
  botReasoningEffort?: string;
  /** 进程启动时注入的供应商注册表(含密钥,仅服务端);未注入时按 env 合成默认 anthropic。 */
  botRegistry?: BotProviderRegistry;
}

const DEFAULT_TURN_TIMEOUT_MS = 20_000;
// 大模型机器人展示倒计时默认值:比真人(20s)长,留出推理时间;到点不兜底,可停在 0 继续等模型。
const DEFAULT_LLM_BOT_TURN_TIMER_MS = 30_000;
const QUICK_START_BOT_COUNT = 2;
// 活跃房间刷新 DB updatedAt 的心跳间隔，须远小于 API 侧 30min 的孤儿清扫时限
const HEARTBEAT_INTERVAL_MS = 10 * 60_000;
// 大模型「AI 输出流」节流阈值:增量累积到约一短句(16 字)才广播一条,避免逐 token 的消息风暴。
const THINKING_MIN_CHARS = 16;
type BotStreamChannel = "reasoning" | "text";
type BotStreamBuffers = Partial<Record<BotStreamChannel, string>> & {
  readonly choice?: LlmDecisionChoice;
};
type RevealedHands = NonNullable<Extract<GameEvent, { type: "round_settled" }>["revealedHands"]>;

/**
 * 单进程内 roomCode → roomId 注册表。
 * Colyseus 并发 joinOrCreate 的串行锁有 0.5s 超时逃逸：恢复路径含 API 往返，
 * 超时后第二个请求会为同一 roomCode 再建实例（双实例脑裂），这里同步兜底拒绝。
 * 多进程部署需换成共享存储 claim，本期单进程足够。
 */
const liveRoomsByCode = new Map<string, string>();

export class DdzRoom extends Room {
  /** join 前 JWT 校验所需的配置，进程启动时注入。 */
  static authTokenConfig: TokenConfig | null = null;

  maxClients = 3;
  private readonly table = new GameTable();
  private readonly tasks = new SerialTaskQueue();
  // 机器人大脑:onCreate 时按「建房 options + BOT_DECISION env 默认」解析(见 resolveBotBrain),默认规则 bot。
  // 决策一律在串行锁外执行(见 BotBrain 契约);叫/抢地主走固定规则隔离实验变量;选 LLM 但缺 key 时建房直接报错(不回退)。
  private botBrain: BotBrain = new RuleBotBrain();
  // 机器人人格解说:默认关闭(BOT_CHAT_ENABLED=true 才启用);纯装饰,不参与决策、不持有串行锁。
  // 解说用注册表默认模型,需在 setupRoom 拿到注册表后重建;此处先给空解说兜底。
  private readonly commentary = commentaryConfigFromEnv();
  private commentator: Commentator = new NullCommentator();
  private readonly clientPlayers = new Map<string, PlayerId>();
  private readonly playerSessions = new Map<PlayerId, Set<string>>();
  private persistence!: RoomPersistence;
  private turnScheduler!: RoomTurnScheduler;
  // LLM 出牌决策的逐手留证(JSONL);仅 BOT_DECISION_TRACE=true 时非空,供实验排错/优化。
  private traceSink: LlmTraceSink | null = null;
  // 大模型「AI 输出流」每个 bot 的待广播片段缓冲(按字数节流);有键即代表本手产生过输出(决定收尾是否发 done)。
  private readonly streamBuffers = new Map<PlayerId, BotStreamBuffers>();
  private roomCode!: string;
  // null = 走 botTiming 的拟真区间;非空 = 固定延迟(测试/CI 逃生阀)
  private fixedBotDelayMs: number | null = null;
  private botIds: PlayerId[] = [];
  /** 展示用昵称表（来自 JWT claims），快照下发时注入 */
  private readonly nicknames = new Map<PlayerId, string>();
  private turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS;
  private llmBotTurnTimerMs = DEFAULT_LLM_BOT_TURN_TIMER_MS;
  private failed = false;
  /** onCreate 是否完整成功：失败实例随后仍会被 autoDispose 收割，onDispose 据此跳过 DB 收尾 */
  private created = false;

  /** join 前校验 JWT，返回的 claims 会作为 client.auth 传入 onJoin。 */
  static override async onAuth(token: string, options: JoinOptions | undefined): Promise<AccessTokenClaims> {
    if (!DdzRoom.authTokenConfig) {
      throw new Error("Token config is not configured for DdzRoom.");
    }

    const accessToken = options?.accessToken?.trim() || token;
    if (!accessToken) {
      throw new Error("Access token is required to join the game room.");
    }

    return verifyAccessToken(accessToken, DdzRoom.authTokenConfig);
  }

  async onCreate(options: RoomCreateOptions): Promise<void> {
    this.fixedBotDelayMs = readFixedBotDelayMs(options.botMoveDelayMs);
    this.turnTimeoutMs = readTurnTimeoutMs(options.turnTimeoutMs);
    this.llmBotTurnTimerMs = readLlmBotTurnTimerMs(options.llmBotTurnTimerMs);
    this.roomCode = readRoomCode(options);

    // 同步注册必须在首个 await 之前，并发建房才能被立即拒绝
    if (liveRoomsByCode.has(this.roomCode)) {
      throw new Error(`Room ${this.roomCode} is already live in this process.`);
    }
    liveRoomsByCode.set(this.roomCode, this.roomId);

    try {
      await this.setupRoom(options);
      this.created = true;
    } catch (error) {
      // onCreate 抛错后 MatchMaker 不清理实例，构造器注册的 dispose 监听与
      // __init 武装的 autoDispose 定时器（约 15s）仍会触发 onDispose——
      // 注册项在此先行自清，onDispose 再以 created 标志跳过 DB 收尾
      this.releaseLiveRegistration();
      throw error;
    }
  }

  private async setupRoom(options: RoomCreateOptions): Promise<void> {
    // 注册表持有各 provider 的密钥(仅服务端);未注入时按 env 合成默认 anthropic 注册表。
    const registry = options.botRegistry ?? parseBotProviderRegistry(null);
    // LLM 决策留证 sink:env 开关默认关;开启时把每手 trace 落成本房间的 JSONL。规则 bot 不产 trace。
    this.traceSink = createLlmTraceSink(process.env, this.roomCode);
    // onStreamDelta 无条件接上(AI 输出流给玩家看的实时流,与 BOT_DECISION_TRACE 落盘正交);规则 bot 永不触发它。
    const hooks: BotBrainHooks = {
      ...(this.traceSink ? { onTrace: (trace: LlmDecisionTrace) => this.traceSink?.record(trace) } : {}),
      onStreamDelta: (playerId, delta) => this.appendAiStream(playerId, delta.channel, delta.text),
      onChoice: (playerId, choice) => this.setAiStreamChoice(playerId, choice)
    };
    this.botBrain = resolveBotBrain(options, registry, hooks);
    if (this.commentary.enabled) {
      this.commentator = new LlmCommentator({
        model: resolveModel(registry.default, registry),
        timeoutMs: this.commentary.timeoutMs,
        maxChars: this.commentary.maxChars
      });
    }
    this.persistence = new RoomPersistence(this.roomCode, options.roomStatusClient, options.gameActionClient, () =>
      this.dumpLiveState()
    );

    // 一次调用同时拿到房间状态与恢复信封：有信封 ⇒ 旧进程崩溃残留，走恢复
    const { room, state } = await options.roomStatusClient.getRoomState(this.roomCode);
    if (room.status === "closed") {
      throw new Error(`Room ${this.roomCode} is closed.`);
    }

    if (state) {
      this.restoreFromState(state);
    } else {
      if (room.status !== "open") {
        throw new Error(`Room ${this.roomCode} is ${room.status} with no recoverable state.`);
      }
      const matchBotCount = readMatchBotCount(options.matchBotCount);
      const botCount =
        matchBotCount ?? (readQuickStart(options.quickStart) ? QUICK_START_BOT_COUNT : readBotCount(options.botCount));
      this.maxClients = 3 - botCount;
      this.addBots(botCount);
    }

    this.turnScheduler = new RoomTurnScheduler({
      botIds: this.botIds,
      // 固定逃生阀优先;否则按快照走拟真区间
      nextBotDelayMs: (snapshot) => this.fixedBotDelayMs ?? botTurnDelayMs(snapshot),
      clock: this.clock,
      enqueue: (task) => {
        // 已失败的房间不再执行迟到的调度任务（bot/超时），与 token 失效形成双保险，收口于入队层
        void this.tasks.enqueue(async () => {
          if (this.failed) {
            return;
          }
          await task();
        });
      },
      onBotTurn: (playerId, isValid) => this.handleBotTurn(playerId, isValid),
      onFailure: (error, reason) => this.failRoom(error, reason),
      onTurnTimeout: (playerId) => this.handleTurnTimeout(playerId),
      onTurnTimer: (event) => {
        this.broadcast("event", {
          type: "turn_timer",
          playerId: event.playerId,
          deadlineAt: event.deadlineAt,
          durationMs: event.durationMs,
          snapshot: this.snapshotDto(event.snapshot)
        } satisfies GameEvent);
      },
      turnTimeoutMs: this.turnTimeoutMs,
      // bot 回合也显示倒计时(与真人一致):大模型用更长的展示时长,规则 bot 与真人同档。
      // 仅视觉,scheduleTurnTimer 不为 bot 安排兜底动作。
      botTurnTimerMs: this.botBrain instanceof LlmBotBrain ? this.llmBotTurnTimerMs : this.turnTimeoutMs
    });
    this.setMetadata({
      roomCode: this.roomCode
    });
    this.setPrivate(false);
    this.onMessage("command", async (client, payload) => {
      await this.tasks.enqueue(() => this.handleCommand(client, payload));
    });
    // 长期空闲（局间挂机）的活房没有动作落库，靠心跳免于被孤儿清扫误杀；
    // 空房生命周期则交给 Colyseus autoDispose（预留座位感知，过期即处置）
    this.clock.setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    if (state) {
      // scheduler 就绪后才能恢复牌局推进
      this.resumeRestoredGame();
    }
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    await this.tasks.enqueue(() => this.handleJoin(client, options));
  }

  async onLeave(client: Client): Promise<void> {
    await this.tasks.enqueue(() => this.handleLeave(client));
  }

  async onDispose(): Promise<void> {
    this.turnScheduler?.cancelAll();
    // 等挂起的决策 trace 写完落盘(不阻断后续 DB 收尾;失败 sink 内部已自行告警)。
    await this.traceSink?.close().catch(() => undefined);
    try {
      // onCreate 失败的僵尸实例不拥有该房间码，绝不能动 DB（否则会把
      // 别的实例或可恢复牌局标记 closed 并删掉状态行）；failRoom 已自行上报 closed
      if (!this.created || this.failed) {
        return;
      }
      await this.persistence.closeRoom();
    } catch (error) {
      console.error(`[DdzRoom ${this.roomCode}] Failed to close room on dispose.`, error);
    } finally {
      // 必须等 closed 落库后才释放注册：先释放会让并发建房在状态行删除前
      // 恢复出第二个实例，随后旧实例的 PATCH closed 又会删掉新实例的状态行
      this.releaseLiveRegistration();
    }
  }

  private releaseLiveRegistration(): void {
    if (this.roomCode && liveRoomsByCode.get(this.roomCode) === this.roomId) {
      liveRoomsByCode.delete(this.roomCode);
    }
  }

  /** 每次落库随动作携带的崩溃恢复信封 */
  private dumpLiveState(): RoomLiveStateEnvelope {
    return {
      version: 1,
      table: this.table.dump(),
      nicknames: Object.fromEntries(this.nicknames)
    };
  }

  /** 崩溃恢复：还原牌桌、bot 名单、昵称表与座位容量；真人连接需等待重连 */
  private restoreFromState(state: RoomLiveStateEnvelope): void {
    this.table.restore(state.table);
    for (const [playerId, nickname] of Object.entries(state.nicknames)) {
      this.nicknames.set(playerId, nickname);
    }
    for (const player of state.table.players) {
      if (player.kind === "bot") {
        // 必须 push 进现有数组：turnScheduler 持有的是数组引用
        this.botIds.push(player.id);
      } else {
        this.table.setConnected(player.id, false);
      }
    }
    // 局间相位没有手牌，离线真人直接让座（与"等待期离开即让座"语义一致），
    // 否则他们永远无法 ready，房间会卡死；牌局中的离线真人保留座位等重连
    this.releaseOfflineHumanSeats();
    this.maxClients = 3 - this.botIds.length;
  }

  /** 按恢复出的相位接续牌局推进 */
  private resumeRestoredGame(): void {
    const snapshot = this.table.snapshot();
    switch (snapshot.phase) {
      case "bidding":
      case "robbing":
      case "playing":
        // 回合计时重置为满额；当前玩家若是 bot 或始终未归队，由 bot 调度/超时代打推进
        this.turnScheduler.scheduleTurnTimer(snapshot);
        this.turnScheduler.scheduleBotTurn(snapshot);
        return;
      case "settled":
        // 结算态不自动开下一局:等待真人点击准备,再重置并让机器人自动准备。
        return;
      case "waiting":
      case "ready":
        // 正常流程里 bot 由 addBots/readyBots 补 ready，恢复后同样补齐
        void this.tasks.enqueue(() => this.readyBots());
        return;
    }
  }

  /** 局间相位释放离线真人的座位，返回是否有人让座 */
  private releaseOfflineHumanSeats(): boolean {
    if (!this.canReleaseSeatBeforeRound()) {
      return false;
    }

    let released = false;
    for (const player of this.table.snapshot().players) {
      if (player.kind === "human" && !this.hasActiveSession(player.id)) {
        this.table.removePlayerBeforeRound(player.id);
        this.nicknames.delete(player.id);
        released = true;
      }
    }
    return released;
  }

  /** 周期心跳：有人在房则刷新 DB updatedAt，失败不致命（孤儿清扫有 30min 余量） */
  private async heartbeat(): Promise<void> {
    if (this.failed || this.clients.length === 0) {
      return;
    }

    try {
      await this.persistence.heartbeat();
    } catch (error) {
      console.error(`[DdzRoom ${this.roomCode}] Heartbeat failed.`, error);
    }
  }

  private async handleJoin(client: Client, options: JoinOptions): Promise<void> {
    if (this.failed) {
      throw new Error("Room is closed.");
    }

    const roomCode = parseRoomCode(options.roomCode);
    if (roomCode !== this.roomCode) {
      throw new Error(`Room code ${roomCode} does not match this game room.`);
    }

    // JWT 已由 static onAuth 在 join 前校验，claims 通过 client.auth 传入
    const claims = client.auth as AccessTokenClaims | undefined;
    if (!claims?.sub) {
      throw new Error("Access token is required to join the game room.");
    }

    const playerId = claims.sub;
    const reconnecting = this.table.hasPlayer(playerId);
    const seat = this.table.addPlayer(playerId);
    this.table.setConnected(playerId, true);
    // 入座成功后才登记昵称，满房被拒的玩家不该在昵称表与恢复信封里留痕
    if (claims.nickname) {
      this.nicknames.set(playerId, claims.nickname);
    }
    // 同一玩家的旧会话在新连接生效后踢掉，避免双开占座
    const staleSessions = [...(this.playerSessions.get(playerId) ?? [])].filter((sessionId) => sessionId !== client.sessionId);
    this.clientPlayers.set(client.sessionId, playerId);
    this.bindSession(playerId, client.sessionId);
    for (const sessionId of staleSessions) {
      this.clients.getById(sessionId)?.leave(DUPLICATE_SESSION_CLOSE_CODE);
    }

    const snapshot = this.table.snapshot();
    try {
      await this.persistence.recordMutation({
        actions: [
          {
            type: "player_joined",
            playerId,
            payload: {
              seat,
              reconnecting
            }
          }
        ],
        snapshot
      });
    } catch (error) {
      await this.failRoom(error, "Failed to persist player join.");
      throw error;
    }

    if (reconnecting) {
      this.broadcastConnectionChanged(playerId, true);
    } else {
      this.broadcast("event", {
        type: "player_joined",
        playerId,
        seat,
        snapshot: this.snapshotDto(snapshot)
      } satisfies GameEvent);
    }

    this.sendSnapshot(client);
    this.sendTurnTimer(client, snapshot);
    this.turnScheduler.scheduleBotTurn(snapshot);
  }

  private async handleLeave(client: Client): Promise<void> {
    const playerId = this.clientPlayers.get(client.sessionId);
    if (!playerId) {
      return;
    }

    // 房间已失败：只清理本地映射，不再走持久化与广播
    if (this.failed) {
      this.clientPlayers.delete(client.sessionId);
      this.unbindSession(playerId, client.sessionId);
      return;
    }

    this.clientPlayers.delete(client.sessionId);
    this.unbindSession(playerId, client.sessionId);
    const remainingSessions = this.playerSessions.get(playerId)?.size ?? 0;
    const playerKind = readPlayerKind(playerId, this.table.snapshot());

    let shouldBroadcastPersonalSnapshot = false;
    let connectionChanged: boolean | null = null;
    if (!this.hasActiveSession(playerId)) {
      if (this.canReleaseSeatBeforeRound()) {
        this.table.removePlayerBeforeRound(playerId);
        shouldBroadcastPersonalSnapshot = true;
      } else {
        this.table.setConnected(playerId, false);
        connectionChanged = false;
      }
    }

    const snapshot = this.table.snapshot();
    try {
      await this.persistence.recordMutation({
        actions: [
          {
            type: "player_left",
            playerId,
            payload: {
              remainingSessions
            },
            playerKindOverride: playerKind
          }
        ],
        snapshot
      });
    } catch (error) {
      await this.failRoom(error, "Failed to persist player leave.");
      return;
    }

    if (shouldBroadcastPersonalSnapshot) {
      this.broadcastPersonalSnapshot("snapshot", snapshot);
    } else if (connectionChanged !== null) {
      this.broadcastConnectionChanged(playerId, connectionChanged);
    }
  }

  private bindSession(playerId: PlayerId, sessionId: string): void {
    const sessions = this.playerSessions.get(playerId) ?? new Set<string>();
    sessions.add(sessionId);
    this.playerSessions.set(playerId, sessions);
  }

  private unbindSession(playerId: PlayerId, sessionId: string): void {
    const sessions = this.playerSessions.get(playerId);
    if (!sessions) {
      return;
    }

    sessions.delete(sessionId);
    if (sessions.size === 0) {
      this.playerSessions.delete(playerId);
    }
  }

  private hasActiveSession(playerId: PlayerId): boolean {
    return (this.playerSessions.get(playerId)?.size ?? 0) > 0;
  }

  private canReleaseSeatBeforeRound(): boolean {
    const phase = this.table.snapshot().phase;
    return phase === "waiting" || phase === "ready";
  }

  private broadcastConnectionChanged(playerId: PlayerId, connected: boolean): void {
    this.broadcast("event", {
      type: "player_connection_changed",
      playerId,
      connected,
      snapshot: this.snapshotDto(this.table.snapshot())
    } satisfies GameEvent);
  }

  private async handleCommand(client: Client, payload: unknown): Promise<void> {
    if (this.failed) {
      this.sendRejected(client, "Room is closed.");
      return;
    }

    const parsed = clientCommandSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendRejected(client, parsed.error.issues.map((issue: { message: string }) => issue.message).join("; "));
      return;
    }

    const playerId = this.clientPlayers.get(client.sessionId);
    if (!playerId) {
      this.sendRejected(client, "Client is not bound to a player.");
      return;
    }

    try {
      switch (parsed.data.type) {
        case "ready":
          await this.handleReady(playerId);
          break;
        case "bid_landlord":
          await this.afterBid(this.table.bidLandlord(playerId, parsed.data.called));
          break;
        case "rob_landlord":
          await this.afterRob(this.table.robLandlord(playerId, parsed.data.robbed));
          break;
        case "play_cards":
          await this.afterPlay(this.table.playCards(playerId, parsed.data.cards as CardId[]));
          break;
        case "pass":
          this.table.pass(playerId);
          await this.afterPass(playerId);
          break;
        case "leave_room":
          client.leave();
          break;
      }
    } catch (error) {
      if (error instanceof RoomPersistenceError) {
        await this.failRoom(error, "Failed to persist game state.");
        return;
      }
      this.sendRejected(client, error instanceof Error ? error.message : "Unknown command error.");
    }
  }

  private async handleReady(playerId: PlayerId): Promise<void> {
    if (this.table.snapshot().phase === "settled") {
      this.table.resetForNextRound();
      // 上一局中途掉线的真人此刻让座，否则其永不 ready 会卡死下一局
      this.releaseOfflineHumanSeats();
      await this.afterReady(this.table.setReady(playerId));
      await this.readyBots();
      return;
    }

    await this.afterReady(this.table.setReady(playerId));
  }

  private async afterReady(result: ReadyResult): Promise<void> {
    if (result.roundStarted) {
      await this.persistence.recordMutation({
        actions: [
          {
            type: "player_ready",
            playerId: result.playerId,
            payload: {}
          },
          {
            type: "round_started",
            playerId: null,
            payload: {
              currentPlayerId: result.snapshot.currentPlayerId
            }
          }
        ],
        snapshot: result.snapshot
      });
      this.broadcast("event", {
        type: "player_ready",
        playerId: result.playerId,
        snapshot: this.snapshotDto(result.snapshot)
      } satisfies GameEvent);
      this.broadcastPersonalSnapshot("round_started", result.snapshot);
      this.turnScheduler.scheduleTurnTimer(result.snapshot);
      this.turnScheduler.scheduleBotTurn(result.snapshot);
      return;
    }

    await this.persistence.recordMutation({
      actions: [
        {
          type: "player_ready",
          playerId: result.playerId,
          payload: {}
        }
      ],
      snapshot: result.snapshot
    });
    this.broadcast("event", {
      type: "player_ready",
      playerId: result.playerId,
      snapshot: this.snapshotDto(result.snapshot)
    } satisfies GameEvent);
    this.broadcastPersonalSnapshot("snapshot", result.snapshot);
    this.turnScheduler.scheduleTurnTimer(result.snapshot);
    this.turnScheduler.scheduleBotTurn(result.snapshot);
  }

  private async afterBid(result: ReturnType<GameTable["bidLandlord"]>): Promise<void> {
    await this.persistence.recordMutation({
      actions: [
        {
          type: "landlord_bid",
          playerId: result.playerId,
          payload: {
            called: result.called,
            redealt: result.redealt
          }
        }
      ],
      snapshot: result.snapshot
    });
    this.broadcastPersonalEvent((playerId) => ({
      type: "landlord_bid",
      playerId: result.playerId,
      called: result.called,
      redealt: result.redealt,
      snapshot: this.snapshotDto(result.snapshot),
      hand: toCardsDto(this.table.getHand(playerId))
    }));
    this.turnScheduler.scheduleTurnTimer(result.snapshot);
    this.turnScheduler.scheduleBotTurn(result.snapshot);
  }

  private async afterRob(result: ReturnType<GameTable["robLandlord"]>): Promise<void> {
    await this.persistence.recordMutation({
      actions: [
        {
          type: "landlord_robbed",
          playerId: result.playerId,
          payload: {
            robbed: result.robbed,
            decided: result.decided,
            landlordId: result.landlordId
          }
        }
      ],
      snapshot: result.snapshot
    });
    this.broadcastPersonalEvent((playerId) => ({
      type: "landlord_robbed",
      playerId: result.playerId,
      robbed: result.robbed,
      decided: result.decided,
      landlordId: result.landlordId,
      snapshot: this.snapshotDto(result.snapshot),
      hand: toCardsDto(this.table.getHand(playerId))
    }));
    this.turnScheduler.scheduleTurnTimer(result.snapshot);
    this.turnScheduler.scheduleBotTurn(result.snapshot);
  }

  private async afterPlay(play: PublicPlay): Promise<void> {
    const snapshot = this.table.snapshot();

    if (snapshot.phase === "settled" && snapshot.settlement) {
      await this.persistence.recordMutation({
        actions: [
          {
            type: "cards_played",
            playerId: play.playerId,
            payload: {
              cards: play.cards.map((card) => card.id),
              combination: play.combination.kind
            }
          },
          {
            type: "round_settled",
            playerId: snapshot.settlement.winnerId,
            payload: {
              settlement: toSettlementDto(snapshot.settlement)
            }
          }
        ],
        snapshot
      });
      this.broadcastPersonalEvent((playerId) => ({
        type: "round_settled",
        settlement: toSettlementDto(snapshot.settlement!),
        snapshot: this.snapshotDto(snapshot),
        hand: toCardsDto(this.table.getHand(playerId)),
        revealedHands: this.revealedHandsDto(snapshot)
      }));
      this.turnScheduler.cancelAll();
      return;
    }

    await this.persistence.recordMutation({
      actions: [
        {
          type: "cards_played",
          playerId: play.playerId,
          payload: {
            cards: play.cards.map((card) => card.id),
            combination: play.combination.kind
          }
        }
      ],
      snapshot
    });
    for (const client of this.clients) {
      const playerId = this.clientPlayers.get(client.sessionId);
      if (!playerId) {
        continue;
      }

      client.send("event", {
        type: "cards_played",
        play: toPublicPlayDto(play),
        snapshot: this.snapshotDto(snapshot),
        hand: toCardsDto(this.table.getHand(playerId))
      } satisfies GameEvent);
    }
    this.turnScheduler.scheduleTurnTimer(snapshot);
    this.turnScheduler.scheduleBotTurn(snapshot);
  }

  private async afterPass(playerId: PlayerId): Promise<void> {
    const snapshot = this.table.snapshot();

    await this.persistence.recordMutation({
      actions: [
        {
          type: "player_passed",
          playerId,
          payload: {
            passCount: snapshot.passCount,
            nextPlayerId: snapshot.currentPlayerId
          }
        }
      ],
      snapshot
    });
    this.broadcast("event", {
      type: "player_passed",
      playerId,
      snapshot: this.snapshotDto(snapshot)
    } satisfies GameEvent);
    this.turnScheduler.scheduleTurnTimer(snapshot);
    this.turnScheduler.scheduleBotTurn(snapshot);
  }

  private addBots(botCount: number): void {
    // 生成可辨认的机器人昵称（与房内已有昵称去重）；存入 nicknames 后随快照下发并参与崩溃恢复
    const names = pickBotNicknames(botCount, this.nicknames.values());
    for (let index = 0; index < botCount; index += 1) {
      const botId = `bot:${this.roomCode}:${index + 1}`;
      this.table.addBot(botId);
      this.nicknames.set(botId, names[index]!);
      const result = this.table.setReady(botId);
      if (result.roundStarted) {
        throw new Error("Bots cannot start a round before a human player joins.");
      }
      this.botIds.push(botId);
    }
  }

  private async handleBotTurn(playerId: PlayerId, isValid: () => boolean): Promise<void> {
    // 锁外:只读快照决策(LLM 等慢速实现不持有串行锁,避免卡住整个房间)。
    const snapshot = this.table.snapshot();
    if (!isValid() || snapshot.currentPlayerId !== playerId) {
      return;
    }

    let action: BotAction;
    try {
      action = await this.botBrain.decide(snapshot, playerId, this.table.getHand(playerId), this.table.playedCards());
    } finally {
      // 无论决策成功/抛错(失败将关房),都收尾本手 AI 输出流:flush 剩余片段 + done,清缓冲。
      this.endAiStream(playerId);
    }

    // 锁内:应用权威动作 + 落库 + 广播。await 期间局面可能已推进,入队后再校验一次。
    await this.tasks.enqueue(async () => {
      if (this.failed || !isValid() || this.table.snapshot().currentPlayerId !== playerId) {
        return;
      }
      await this.applyBotAction(playerId, action);
    });
  }

  private async applyBotAction(playerId: PlayerId, action: BotAction): Promise<void> {
    try {
      switch (action.type) {
        case "bid_landlord":
          await this.afterBid(this.table.bidLandlord(playerId, action.called));
          break;
        case "rob_landlord":
          await this.afterRob(this.table.robLandlord(playerId, action.robbed));
          break;
        case "pass":
          this.table.pass(playerId);
          await this.afterPass(playerId);
          break;
        case "play_cards": {
          const play = this.table.playCards(playerId, action.cards);
          await this.afterPlay(play);
          this.fireBotChat(playerId, play);
          break;
        }
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Bot action failed.", {
        cause: error
      });
    }
  }

  /**
   * AI 输出流:累积该 bot 的 reasoning/text 增量,按字数节流广播 bot_ai_stream(done:false)。
   * 锁外回调(决策在锁外流式产出);只要被调用过就在 streamBuffers 留键,作为「本手产生过输出」的标记。
   */
  private appendAiStream(playerId: PlayerId, channel: BotStreamChannel, delta: string): void {
    if (this.failed) {
      return;
    }
    const buffers = this.streamBuffers.get(playerId) ?? {};
    const pending = (buffers[channel] ?? "") + delta;
    const { chunk, rest } = takeThinkingChunk(pending, THINKING_MIN_CHARS);
    this.streamBuffers.set(playerId, { ...buffers, [channel]: rest });
    if (chunk !== null) {
      this.broadcast("event", {
        type: "bot_ai_stream",
        playerId,
        channel,
        text: chunk,
        done: false
      } satisfies GameEvent);
    }
  }

  /** 记录本手 LLM 最终选择的候选动作;作为 AI 输出流的收尾元数据展示给前端。 */
  private setAiStreamChoice(playerId: PlayerId, choice: LlmDecisionChoice): void {
    if (this.failed) {
      return;
    }
    const buffers = this.streamBuffers.get(playerId) ?? {};
    this.streamBuffers.set(playerId, { ...buffers, choice });
  }

  /** 收尾本手 AI 输出流:把剩余片段/最终选择连同 done:true 一并广播,清缓冲。本手没产生过输出(无键)则什么都不发。 */
  private endAiStream(playerId: PlayerId): void {
    const buffers = this.streamBuffers.get(playerId);
    if (!buffers) {
      return;
    }
    this.streamBuffers.delete(playerId);
    if (this.failed) {
      return;
    }
    let sent = false;
    for (const channel of ["reasoning", "text"] as const) {
      if (!(channel in buffers)) {
        continue;
      }
      this.broadcast("event", {
        type: "bot_ai_stream",
        playerId,
        channel,
        text: buffers[channel] ?? "",
        done: true,
        ...(buffers.choice ? { choice: buffers.choice } : {})
      } satisfies GameEvent);
      sent = true;
    }
    if (!sent && buffers.choice) {
      this.broadcast("event", {
        type: "bot_ai_stream",
        playerId,
        channel: "text",
        text: "",
        done: true,
        choice: buffers.choice
      } satisfies GameEvent);
    }
  }

  /** 机器人出牌后异步生成一句解说并广播;纯装饰:未启用/失败静默,fire-and-forget 不持有串行锁。 */
  private fireBotChat(playerId: PlayerId, play: PublicPlay): void {
    if (!this.commentary.enabled) {
      return;
    }

    const snapshot = this.table.snapshot();
    const self = snapshot.players.find((player) => player.id === playerId);
    if (!self) {
      return;
    }

    const context: CommentaryContext = {
      persona: this.commentary.persona,
      selfNickname: this.nicknames.get(playerId) ?? "机器人",
      role: snapshot.landlordId === playerId ? "landlord" : "farmer",
      event: `打出了${combinationLabel(play.combination.kind)}(${play.cards.length}张)`,
      selfHandCount: self.handCount,
      opponentHandCounts: snapshot.players
        .filter((player) => player.id !== playerId)
        .map((player) => player.handCount)
    };

    const nickname = this.nicknames.get(playerId);
    void this.commentator
      .comment(context)
      .then((text) => {
        if (text && !this.failed) {
          this.broadcast("event", {
            type: "bot_chat",
            playerId,
            text,
            ...(nickname === undefined ? {} : { nickname })
          } satisfies GameEvent);
        }
      })
      .catch(() => undefined);
  }

  private async handleTurnTimeout(playerId: PlayerId): Promise<void> {
    const snapshot = this.table.snapshot();
    if (snapshot.currentPlayerId !== playerId) {
      return;
    }

    try {
      const action = decideTimeoutAction(snapshot, playerId, this.table.getHand(playerId));
      switch (action.type) {
        case "bid_landlord":
          await this.afterBid(this.table.bidLandlord(playerId, action.called));
          break;
        case "rob_landlord":
          await this.afterRob(this.table.robLandlord(playerId, action.robbed));
          break;
        case "pass":
          this.table.pass(playerId);
          await this.afterPass(playerId);
          break;
        case "play_cards":
          await this.afterPlay(this.table.playCards(playerId, action.cards));
          break;
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Turn timeout failed.", {
        cause: error
      });
    }
  }

  private snapshotDto(snapshot: GameSnapshot) {
    return toSnapshotDto(snapshot, this.nicknames);
  }

  private async readyBots(): Promise<void> {
    if (this.failed) {
      return;
    }

    for (const botId of this.botIds) {
      const snapshot = this.table.snapshot();
      if (snapshot.phase !== "waiting" && snapshot.phase !== "ready") {
        return;
      }

      const bot = snapshot.players.find((player) => player.id === botId);
      if (!bot || bot.ready) {
        continue;
      }

      try {
        await this.afterReady(this.table.setReady(botId));
      } catch (error) {
        await this.failRoom(error, "Failed to ready bot for the next round.");
        return;
      }
    }
  }

  private revealedHandsDto(snapshot: GameSnapshot): RevealedHands {
    return snapshot.players.map((player) => ({
      playerId: player.id,
      cards: toCardsDto(this.table.getHand(player.id))
    }));
  }

  /** 给客户端补发当前回合计时，重连后才能拿到剩余时间。 */
  private sendTurnTimer(client: Client, snapshot: GameSnapshot): void {
    const timer = this.turnScheduler.getActiveTurnTimer();
    if (!timer) {
      return;
    }

    client.send("event", {
      type: "turn_timer",
      playerId: timer.playerId,
      deadlineAt: timer.deadlineAt,
      durationMs: timer.durationMs,
      snapshot: this.snapshotDto(snapshot)
    } satisfies GameEvent);
  }

  private sendSnapshot(client: Client): void {
    const playerId = this.clientPlayers.get(client.sessionId);
    if (!playerId) {
      return;
    }

    const snapshot = this.table.snapshot();
    client.send("event", {
      type: "snapshot",
      snapshot: this.snapshotDto(snapshot),
      hand: toCardsDto(this.table.getHand(playerId)),
      ...this.revealedHandsEventPart(snapshot)
    } satisfies GameEvent);
  }

  private broadcastPersonalSnapshot(type: "snapshot" | "round_started", snapshot: GameSnapshot): void {
    for (const client of this.clients) {
      const playerId = this.clientPlayers.get(client.sessionId);
      if (!playerId) {
        continue;
      }

      client.send("event", {
        type,
        snapshot: this.snapshotDto(snapshot),
        hand: toCardsDto(this.table.getHand(playerId)),
        ...(type === "snapshot" ? this.revealedHandsEventPart(snapshot) : {})
      } satisfies GameEvent);
    }
  }

  private revealedHandsEventPart(snapshot: GameSnapshot): { readonly revealedHands: RevealedHands } | {} {
    return snapshot.phase === "settled" ? { revealedHands: this.revealedHandsDto(snapshot) } : {};
  }

  private sendRejected(client: Client, reason: string): void {
    client.send("event", {
      type: "command_rejected",
      reason
    } satisfies GameEvent);
  }

  private broadcastPersonalEvent(createEvent: (playerId: PlayerId) => GameEvent): void {
    for (const client of this.clients) {
      const playerId = this.clientPlayers.get(client.sessionId);
      if (!playerId) {
        continue;
      }

      client.send("event", createEvent(playerId));
    }
  }

  private async failRoom(error: unknown, defaultReason: string): Promise<void> {
    // 幂等：失败只处理一次，disconnect 触发的 onLeave 等回调不会再次进入
    if (this.failed) {
      return;
    }

    this.failed = true;
    this.turnScheduler.cancelAll();
    // 详细错误只进服务端日志，客户端收到通用文案
    const detail = error instanceof Error ? error.message : defaultReason;
    console.error(`[DdzRoom ${this.roomCode}] ${defaultReason} ${detail}`, error);

    try {
      this.broadcast("event", {
        type: "room_failed",
        reason: "Room closed due to an internal error."
      } satisfies GameEvent);
    } catch (broadcastError) {
      console.error(`[DdzRoom ${this.roomCode}] Failed to broadcast room_failed.`, broadcastError);
    }

    try {
      await this.persistence.closeFailedRoom(detail, this.table.snapshot());
    } catch (closeError) {
      console.error(`[DdzRoom ${this.roomCode}] Failed to close room in API.`, closeError);
    }

    await this.lock();
    // 不在串行队列内等待 disconnect：onLeave 与本方法同走一条队列，等待会死锁
    void this.disconnect(1011).catch((disconnectError) => {
      console.error(`[DdzRoom ${this.roomCode}] Failed to disconnect room.`, disconnectError);
    });
  }
}

function readRoomCode(options: { roomCode?: unknown }): string {
  return parseRoomCode(options.roomCode);
}

function readTurnTimeoutMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TURN_TIMEOUT_MS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Turn timeout must be a positive integer in milliseconds.");
  }
  return value;
}

function readLlmBotTurnTimerMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LLM_BOT_TURN_TIMER_MS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("LLM bot turn timer must be a positive integer in milliseconds.");
  }
  return value;
}

function readBotCount(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error("Bot count must be an integer between 0 and 2.");
  }
  return value;
}

/** 撮合房专用 bot 数：与 define 注入的 botCount 区分，避免被 handler options 覆盖 */
function readMatchBotCount(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error("Match bot count must be an integer between 0 and 2.");
  }
  return value;
}

function readQuickStart(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error("Quick start must be a boolean.");
  }
  return value;
}

function readFixedBotDelayMs(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Bot move delay must be a non-negative integer in milliseconds.");
  }
  return value;
}

function parseRoomCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Room code is required to join the game room.");
  }

  // 严格校验：只接受规范格式（6 位数字），不做 trim 之类的静默修正
  if (!ROOM_CODE_REGEX.test(value)) {
    throw new Error("Room code must be 6 digits.");
  }

  return value;
}
