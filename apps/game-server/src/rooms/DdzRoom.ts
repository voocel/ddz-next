import type { Client } from "@colyseus/core";
import { Room } from "@colyseus/core";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import {
  commentaryConfigFromEnv,
  LlmArenaCommentator,
  LlmCommentator,
  NullCommentator,
  parseBotProviderRegistry,
  resolveModel,
  type BotProviderRegistry,
  type Commentator,
  type CommentaryContext,
  type ModelRef
} from "@ddz/bot-ai";
import { GameTable } from "@ddz/domain";
import { clientCommandSchema, DUPLICATE_SESSION_CLOSE_CODE } from "@ddz/protocol";
import type { CardId, GameSnapshot, PlayerId, PublicPlay, ReadyResult } from "@ddz/domain";
import type { GameEvent, RoomLiveStateEnvelope } from "@ddz/protocol";
import type { GameActionClient } from "../api/gameActionClient.js";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { readPlayerKind, toCardsDto, toPublicPlayDto, toSettlementDto, toSnapshotDto } from "../dto.js";
import type { BotAction, BotBrain } from "./botBrain.js";
import { RuleBotBrain } from "./ruleBotBrain.js";
import { botTurnDelayMs } from "./botTiming.js";
import { pickBotNicknames } from "./botNames.js";
import {
  createBotBrain,
  resolveDecisionConfig,
  type BotBrainHooks,
  type ResolvedDecision
} from "./botDecision.js";
import { arenaCommentaryModelFromEnv, ArenaCommentaryDirector } from "./arenaCommentary.js";
import { ArenaDirector } from "./arenaDirector.js";
import { LlmBotBrain, type LlmDecisionTrace } from "./llmBotBrain.js";
import { BotStreamBroadcaster } from "./botStreamBroadcaster.js";
import { BotTurnController } from "./botTurnController.js";
import { createLlmTraceSink, type LlmTraceSink } from "./llmTraceSink.js";
import { combinationLabel, describeCombination } from "./combinationLabels.js";
import { RoomPersistence, RoomPersistenceError } from "./roomPersistence.js";
import { SerialTaskQueue } from "./serialTaskQueue.js";
import { RoomTurnScheduler } from "./roomTurnScheduler.js";
import { decideTimeoutAction } from "./timeoutAction.js";
import { releaseAiBattleSlot, reserveAiBattleSlot } from "./aiBattleSlots.js";
import {
  DEFAULT_LLM_BOT_TURN_TIMER_MS,
  DEFAULT_TURN_TIMEOUT_MS,
  lineupBotNicknames,
  parseRoomCode,
  QUICK_START_BOT_COUNT,
  readArena,
  readArenaIntermissionMs,
  readArenaMaxRounds,
  readArenaMaxSpectators,
  readBotCount,
  readBotRetryMaxAttempts,
  readEnvBotReasoningEffort,
  readFixedBotDelayMs,
  readLineup,
  readLlmBotTurnTimerMs,
  readQuickStart,
  readRoomClaimTtlMs,
  readRoomCode,
  readSpectate,
  readTurnTimeoutMs,
  roomClaimHeartbeatIntervalMs,
  usesLlmBotDecision
} from "./roomOptions.js";

interface JoinOptions {
  accessToken?: string;
  roomCode?: string;
  quickStart?: boolean;
  /** true 时以观众身份加入:不占座、无手牌视角,只收公开事件;仍需 JWT 登录。 */
  spectate?: boolean;
}

interface RoomCreateOptions extends JoinOptions {
  roomStatusClient: RoomStatusClient;
  gameActionClient: GameActionClient;
  botCount?: number;
  /** true 建全 AI 竞技场房:3 个 LLM 席位对战,真人只能观战,局间自动推进。 */
  arena?: boolean;
  /** 阵容:竞技场恰好 3 席;非竞技场给出即为挑战桌(1 真人 + 恰好 2 个 LLM 对手)。不可信,逐项经注册表校验,非法即拒绝建房。 */
  lineup?: unknown;
  /** 固定机器人延迟(ms)的测试/CI 逃生阀:设置则用此定值,不设置(undefined)则走 botTiming 的拟真区间 */
  botMoveDelayMs?: number | undefined;
  turnTimeoutMs?: number;
  /** 大模型机器人回合的展示倒计时(ms):仅视觉,到点不触发兜底,LLM 决策真超时由 BOT_DECISION_TIMEOUT_MS 收口。 */
  llmBotTurnTimerMs?: number;
  /** 客户端选择的机器人决策来源(rule|llm)与模型(provider+model);不可信,服务端校验后才生效。 */
  botDecisionMode?: string;
  botProvider?: string;
  botModel?: string;
  /** 客户端所选思考强度档位(auto|off|low|medium|high);不可信,resolveDecisionConfig 校验后才生效。 */
  botReasoningEffort?: string;
  /** 进程启动时注入的供应商注册表(含密钥,仅服务端);未注入时按 env 合成默认 anthropic。 */
  botRegistry?: BotProviderRegistry;
}

// 随动作 payload 落库的 reasoning 摘要上限,防止超长思考把 action 行撑爆。
const AI_TRACE_REASONING_MAX_CHARS = 4096;
type RevealedHands = NonNullable<Extract<GameEvent, { type: "round_settled" }>["revealedHands"]>;

/**
 * 单进程内 roomCode → roomId 注册表。
 * Colyseus 并发 joinOrCreate 的串行锁有 0.5s 超时逃逸：恢复路径含 API 往返，
 * 超时后第二个请求会为同一 roomCode 再建实例（双实例脑裂），这里同步兜底拒绝。
 * 跨进程互斥由 API RoomClaim 租约保证。
 */
const liveRoomsByCode = new Map<string, string>();

export class DdzRoom extends Room {
  /** join 前 JWT 校验所需的配置，进程启动时注入。 */
  static authTokenConfig: TokenConfig | null = null;

  maxClients = 3;
  private readonly table = new GameTable();
  private readonly tasks = new SerialTaskQueue();
  // 机器人大脑:onCreate 按「建房 options + BOT_DECISION env 默认」解析,建房即定局(无牌桌内热更)。
  // 决策一律在串行锁外执行(见 BotBrain 契约);选 LLM 但缺 key 直接报错(不回退)。
  // botBrain 是房间级默认实例;botBrains 按 bot 逐个登记(lineup 房按席位挂独立模型大脑)。
  private botBrain: BotBrain = new RuleBotBrain();
  private botModel: ModelRef | null = null;
  private readonly botBrains = new Map<PlayerId, BotBrain>();
  // 参局 bot 的模型身份(LLM 时非空),round_settled 随 payload 落库,供战绩/排行按模型聚合。
  private readonly botIdentities = new Map<PlayerId, ModelRef>();
  private botRegistry: BotProviderRegistry | null = null;
  private botBrainHooks: BotBrainHooks = {};
  private aiBattleSlotReserved = false;
  // 建房时的决策配置(超时/思考强度),竞技场席位大脑与崩溃恢复重建大脑复用。
  private decisionConfig: ResolvedDecision | null = null;
  // 竞技场(全 AI 对战)生命周期导演:非 null 即竞技场语义的唯一真相;非竞技场房保持 null。
  private arenaDirector: ArenaDirector | null = null;
  // 两个 env 保持在任意房型构造时即校验(与旧字段同时机),仅竞技场房实际消费。
  private readonly arenaMaxRounds = readArenaMaxRounds();
  private readonly arenaIntermissionMs = readArenaIntermissionMs();
  // 观众会话(不占座、无手牌视角);任何房间都可观战,容量独立于牌桌座位。
  private readonly spectatorSessions = new Set<string>();
  private readonly spectatorCapacity = readArenaMaxSpectators();
  // LLM 决策失败自动重试上限;env 在任意房型构造时即校验,状态机本体在 BotTurnController。
  private readonly botRetryMaxAttempts = readBotRetryMaxAttempts();
  // 成功决策的 trace 摘要(reasoning/延迟/用量),由随后的动作 payload 取走落库(复盘读侧在 P5)。
  private readonly pendingActionTraces = new Map<PlayerId, Record<string, unknown>>();
  // 机器人人格解说:默认关闭(BOT_CHAT_ENABLED=true 才启用);纯装饰,不参与决策、不持有串行锁。
  // 解说用注册表默认模型,需在 setupRoom 拿到注册表后重建;此处先给空解说兜底。
  private readonly commentary = commentaryConfigFromEnv();
  private commentator: Commentator = new NullCommentator();
  private readonly clientPlayers = new Map<string, PlayerId>();
  private readonly playerSessions = new Map<PlayerId, Set<string>>();
  private persistence!: RoomPersistence;
  private turnScheduler!: RoomTurnScheduler;
  // LLM 决策的逐手全量留证(JSONL,常开);onCreate 前为 null。
  private traceSink: LlmTraceSink | null = null;
  // 大模型「AI 输出流」的节流缓冲与广播收尾;闭包动态取 broadcast/failed,bare 实例(测试)亦可用。
  private readonly aiStream = new BotStreamBroadcaster({
    broadcast: (event) => this.broadcast("event", event),
    isFailed: () => this.failed
  });
  // bot 回合执行与 LLM 失败/退避重试状态机(锁外决策→锁内应用的并发契约属主)。
  private botController!: BotTurnController;
  private roomCode!: string;
  // null = 走 botTiming 的拟真区间;非空 = 固定延迟(测试/CI 逃生阀)
  private fixedBotDelayMs: number | null = null;
  private botIds: PlayerId[] = [];
  /** 展示用昵称表（来自 JWT claims），快照下发时注入 */
  private readonly nicknames = new Map<PlayerId, string>();
  private turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS;
  private llmBotTurnTimerMs = DEFAULT_LLM_BOT_TURN_TIMER_MS;
  private claimOwnerId = "";
  private roomClaimed = false;
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
    this.claimOwnerId = `${process.pid}:${this.roomId}`;

    try {
      this.reserveAiBattleSlotIfNeeded(options);

      // 同步注册必须在首个 await 之前，并发建房才能被立即拒绝
      if (liveRoomsByCode.has(this.roomCode)) {
        throw new Error(`Room ${this.roomCode} is already live in this process.`);
      }
      liveRoomsByCode.set(this.roomCode, this.roomId);
      await this.setupRoom(options);
      this.created = true;
    } catch (error) {
      // onCreate 抛错后 MatchMaker 不清理实例，构造器注册的 dispose 监听与
      // __init 武装的 autoDispose 定时器（约 15s）仍会触发 onDispose——
      // 注册项在此先行自清，onDispose 再以 created 标志跳过 DB 收尾
      await this.releaseRoomClaimIfHeld();
      this.releaseLiveRegistration();
      this.releaseAiBattleSlot();
      throw error;
    }
  }

  private async setupRoom(options: RoomCreateOptions): Promise<void> {
    // 注册表持有各 provider 的密钥(仅服务端);未注入时按 env 合成默认 anthropic 注册表。
    const registry = options.botRegistry ?? parseBotProviderRegistry(null);
    this.botRegistry = registry;
    const arena = readArena(options.arena);
    // 阵容即赛事配置,建房时逐项校验(非法即拒,不回退默认):竞技场 3 席全 AI;非竞技场给出 lineup 即挑战桌(2 个 LLM 对手)。
    const lineup = arena
      ? readLineup(options.lineup, registry, 3)
      : options.lineup !== undefined
        ? readLineup(options.lineup, registry, 2)
        : null;
    // LLM 决策留证 sink:env 开关默认关;开启时把每手 trace 落成本房间的 JSONL。规则 bot 不产 trace。
    this.traceSink = createLlmTraceSink(process.env, this.roomCode);
    console.info(`[DdzRoom ${this.roomCode}] LLM decision trace: ${this.traceSink.file}`);
    // onStreamDelta 无条件接上(AI 输出流给玩家看的实时流,与 BOT_DECISION_TRACE 落盘正交);规则 bot 永不触发它。
    const hooks: BotBrainHooks = {
      // trace 双出口:JSONL 留证(可选开关)+ 成功决策摘要暂存,随后由该 bot 动作 payload 取走落库(P2.5 写侧)。
      onTrace: (trace: LlmDecisionTrace) => {
        this.traceSink?.record(trace);
        this.storePendingActionTrace(trace);
      },
      onStreamStart: (playerId) => this.aiStream.start(playerId),
      onStreamDelta: (playerId, delta) => this.aiStream.append(playerId, delta.channel, delta.text),
      onChoice: (playerId, choice) => this.aiStream.setChoice(playerId, choice)
    };
    this.botBrainHooks = hooks;
    // 竞技场以 reasoning 直播为核心观赏点:客户端与环境变量都未显式指定思考档位时,默认开中档
    const decisionOptions =
      arena && options.botReasoningEffort === undefined && readEnvBotReasoningEffort() === undefined
        ? { ...options, botReasoningEffort: "medium" }
        : options;
    const decision = resolveDecisionConfig(decisionOptions, registry);
    this.decisionConfig = decision;
    this.botBrain = createBotBrain(decision, registry, hooks);
    this.botModel = decision.useLlm ? decision.model : null;
    if (this.commentary.enabled) {
      this.commentator = new LlmCommentator({
        model: resolveModel(registry.default, registry),
        timeoutMs: this.commentary.timeoutMs,
        maxChars: this.commentary.maxChars
      });
    }
    if (arena) {
      // 竞技场房不因空场销毁(无人观战也继续打),生命周期由 maxRounds/failRoom 显式收口。
      this.autoDispose = false;
      this.ensureArenaDirector();
    }
    const claimTtlMs = readRoomClaimTtlMs();
    this.persistence = new RoomPersistence(
      this.roomCode,
      options.roomStatusClient,
      options.gameActionClient,
      () => this.dumpLiveState(),
      this.claimOwnerId,
      claimTtlMs
    );
    await this.persistence.claimRoom();
    this.roomClaimed = true;

    // 一次调用同时拿到房间状态与恢复信封：有信封 ⇒ 旧进程崩溃残留，走恢复
    const { room, state } = await options.roomStatusClient.getRoomState(this.roomCode);
    if (room.status === "closed") {
      throw new Error(`Room ${this.roomCode} is closed.`);
    }
    // 观战不建房:spectate 触发的 joinOrCreate 只有在存在可恢复牌局(旧进程崩溃)时才允许拉起房间;
    // arena 建房例外——创建者建房后自身就是首位观众。
    if (!state && readSpectate(options.spectate) && !arena) {
      throw new Error(`房间 ${this.roomCode} 不在直播中。`);
    }

    if (state) {
      this.restoreFromState(state);
    } else {
      if (room.status !== "open") {
        throw new Error(`Room ${this.roomCode} is ${room.status} with no recoverable state.`);
      }
      if (arena && lineup) {
        // 全 AI 房:3 个席位按阵容各挂独立大脑;不在建房时 ready,开局走 readyBots 的完整 round_started 链路。
        this.addBots(3, { autoReady: false, lineup });
        this.maxClients = this.spectatorCapacity;
      } else if (lineup) {
        // 挑战桌:2 个 LLM 对手按阵容各挂独立大脑并就绪,唯一座位留给建桌真人。
        this.addBots(lineup.length, { autoReady: true, lineup });
        this.maxClients = 3 - lineup.length + this.spectatorCapacity;
      } else {
        const botCount = readQuickStart(options.quickStart) ? QUICK_START_BOT_COUNT : readBotCount(options.botCount);
        this.maxClients = 3 - botCount + this.spectatorCapacity;
        this.addBots(botCount);
      }
    }

    // 竞技场耗尽重试即流局(入队 + 失败兜底);真人房传 null = 等待手动重试
    const director = this.arenaDirector;
    this.botController = new BotTurnController({
      roomCode: this.roomCode,
      table: this.table,
      brainFor: (playerId) => this.botBrains.get(playerId),
      retryMaxAttempts: this.botRetryMaxAttempts,
      clock: this.clock,
      enqueue: (task) => this.tasks.enqueue(task),
      isFailed: () => this.failed,
      broadcast: (event) => this.broadcast("event", event),
      toSnapshotDto: (snapshot) => this.snapshotDto(snapshot),
      scheduleTurnTimer: (snapshot) => this.turnScheduler.scheduleTurnTimer(snapshot),
      onApplyAction: (playerId, action) => this.applyBotAction(playerId, action),
      onRetriesExhausted: director
        ? (playerId, message) => {
            void this.tasks.enqueue(async () => {
              try {
                await director.abortRound(playerId, message);
              } catch (abortError) {
                await this.failRoom(abortError, "Failed to abort arena round.");
              }
            });
          }
        : null,
      onFailure: (error, reason) => this.failRoom(error, reason),
      onDecisionSettled: (playerId) => this.aiStream.end(playerId)
    });

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
      onBotTurn: (playerId, isValid) => this.botController.handleTurn(playerId, isValid),
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
      // bot 回合也显示倒计时(与真人一致):任一席位是大模型即用更长的展示时长,规则 bot 与真人同档。
      // 仅视觉,scheduleTurnTimer 不为 bot 安排兜底动作。
      botTurnTimerMs: this.usesLlmBotTimer() ? this.llmBotTurnTimerMs : this.turnTimeoutMs
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
    }, roomClaimHeartbeatIntervalMs(claimTtlMs));

    if (state) {
      // scheduler 就绪后才能恢复牌局推进
      this.resumeRestoredGame();
    } else if (arena) {
      // 全 AI 房无真人可点准备:仿恢复路径入队 readyBots,走完整的 round_started 持久化+调度链路。
      void this.tasks.enqueue(() => this.readyBots());
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
        await this.releaseRoomClaimIfHeld();
        return;
      }
      await this.persistence.closeRoom();
      this.roomClaimed = false;
    } catch (error) {
      console.error(`[DdzRoom ${this.roomCode}] Failed to close room on dispose.`, error);
    } finally {
      // 必须等 closed 落库后才释放注册：先释放会让并发建房在状态行删除前
      // 恢复出第二个实例，随后旧实例的 PATCH closed 又会删掉新实例的状态行
      this.releaseLiveRegistration();
      this.releaseAiBattleSlot();
    }
  }

  private releaseLiveRegistration(): void {
    if (this.roomCode && liveRoomsByCode.get(this.roomCode) === this.roomId) {
      liveRoomsByCode.delete(this.roomCode);
    }
  }

  private reserveAiBattleSlotIfNeeded(options: RoomCreateOptions): void {
    // 竞技场(全 LLM 席位)、挑战桌(lineup 对手)与 LLM 决策房共用同一容量闸门
    if (!readArena(options.arena) && options.lineup === undefined && !usesLlmBotDecision(options)) {
      return;
    }
    reserveAiBattleSlot();
    this.aiBattleSlotReserved = true;
  }

  private releaseAiBattleSlot(): void {
    if (!this.aiBattleSlotReserved) {
      return;
    }
    this.aiBattleSlotReserved = false;
    releaseAiBattleSlot();
  }

  private async releaseRoomClaimIfHeld(): Promise<void> {
    if (!this.roomClaimed) {
      return;
    }
    this.roomClaimed = false;
    await this.persistence?.releaseClaim().catch((error) => {
      console.error(`[DdzRoom ${this.roomCode}] Failed to release room claim.`, error);
    });
  }

  /** 每次落库随动作携带的崩溃恢复信封 */
  private dumpLiveState(): RoomLiveStateEnvelope {
    return {
      version: 1,
      table: this.table.dump(),
      nicknames: Object.fromEntries(this.nicknames),
      // 模型身份随信封落库:恢复时按此重建各席位大脑,防止崩溃后被恢复方 options 静默换脑(规则 bot 顶替 LLM)。
      ...(this.botIdentities.size > 0 ? { botModels: this.botPlayersPayload() } : {}),
      ...(this.arenaDirector ? { arena: true } : {})
    };
  }

  /**
   * 竞技场语义的唯一开关:建房分支与恢复信封共用,幂等。
   * 局数/连败计数不落库,恢复即归零(全新局数额度与流局容忍度)——既有行为,见 ArenaDirector 类注释。
   */
  private ensureArenaDirector(): void {
    if (this.arenaDirector) {
      return;
    }
    const registry = this.botRegistry;
    if (!registry) {
      throw new Error("Bot registry is not initialized.");
    }
    const commentaryModel = arenaCommentaryModelFromEnv(registry);
    this.arenaDirector = new ArenaDirector({
      roomCode: this.roomCode,
      maxRounds: this.arenaMaxRounds,
      intermissionMs: this.arenaIntermissionMs,
      commentary: new ArenaCommentaryDirector({
        // 解说模型缺 key/显式关闭时传 null,LlmArenaCommentator 静默沉默(纯装饰,不影响对局)。
        commentator: new LlmArenaCommentator({
          model: commentaryModel ? resolveModel(commentaryModel, registry) : null
        }),
        broadcast: (text, tag) => {
          if (!this.failed) {
            this.broadcast("event", { type: "commentary", text, tag } satisfies GameEvent);
          }
        }
      }),
      table: this.table,
      clock: this.clock,
      enqueue: (task) => this.tasks.enqueue(task),
      isFailed: () => this.failed,
      nickname: (playerId) => this.nicknames.get(playerId),
      botModel: (playerId) => this.botIdentities.get(playerId)?.model,
      botPlayersPayload: () => this.botPlayersPayload(),
      recordMutation: (input) => this.persistence.recordMutation(input),
      broadcast: (event) => this.broadcast("event", event),
      toSnapshotDto: (snapshot) => this.snapshotDto(snapshot),
      cancelTimers: () => this.turnScheduler.cancelAll(),
      clearBotFailure: (playerId) => this.botController.clearRetryState(playerId),
      readyBots: () => this.readyBots(),
      closeRoom: async () => {
        await this.persistence.closeRoom();
        this.roomClaimed = false;
      },
      disconnect: () => {
        void this.disconnect().catch((error) => {
          console.error(`[DdzRoom ${this.roomCode}] Failed to disconnect arena room.`, error);
        });
      },
      onFailure: (error, reason) => this.failRoom(error, reason)
    });
  }

  /** 崩溃恢复：还原牌桌、bot 名单(含各席位模型大脑)、昵称表与座位容量；真人连接需等待重连 */
  private restoreFromState(state: RoomLiveStateEnvelope): void {
    this.table.restore(state.table);
    if (state.arena) {
      // 恢复方可能只是普通观众(join options 无 arena 标记),以信封为准还原竞技场语义。
      this.ensureArenaDirector();
      this.autoDispose = false;
    }
    for (const [playerId, nickname] of Object.entries(state.nicknames)) {
      this.nicknames.set(playerId, nickname);
    }
    for (const player of state.table.players) {
      if (player.kind === "bot") {
        // 必须 push 进现有数组：turnScheduler 持有的是数组引用
        this.botIds.push(player.id);
        const model = state.botModels?.[player.id];
        if (model) {
          // 按落库身份重建该席位大脑;key 已失效则建房失败(显式暴露,绝不换成规则 bot)。
          this.botBrains.set(player.id, this.buildSeatBrain(model));
          this.botIdentities.set(player.id, model);
        } else {
          this.registerBotBrain(player.id);
        }
      } else {
        this.table.setConnected(player.id, false);
      }
    }
    // 局间相位没有手牌，离线真人直接让座（与"等待期离开即让座"语义一致），
    // 否则他们永远无法 ready，房间会卡死；牌局中的离线真人保留座位等重连
    this.releaseOfflineHumanSeats();
    this.maxClients = 3 - this.botIds.length + this.spectatorCapacity;
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
        // 竞技场恢复到结算态:按局间节奏自动推进;真人房等待真人点击准备。
        this.arenaDirector?.scheduleRoundTransition();
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

  /** 周期心跳：续租房间 claim；已有同步状态时刷新 DB updatedAt，失败不致命（孤儿清扫有 30min 余量） */
  private async heartbeat(): Promise<void> {
    if (this.failed) {
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

    if (readSpectate(options.spectate)) {
      this.handleSpectatorJoin(client);
      return;
    }

    const playerId = claims.sub;
    const reconnecting = this.table.hasPlayer(playerId);
    // 座位容量与观战容量解耦后,满座必须显式拒绝(maxClients 不再挡人),并提示可观战。
    if (!reconnecting && this.table.snapshot().players.length >= 3) {
      throw new Error(this.arenaDirector ? "竞技场房间是全 AI 对战,只能以观战模式加入。" : "牌桌已满员,可以以观战模式加入。");
    }
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
    this.sendPendingBotDecisionFailure(client);
    this.turnScheduler.scheduleBotTurn(snapshot);
  }

  /** 观众入场:只登记会话并补发当前局面(公开视角,无手牌),不占座、不落库、不动牌桌。 */
  private handleSpectatorJoin(client: Client): void {
    this.spectatorSessions.add(client.sessionId);
    const snapshot = this.table.snapshot();
    client.send("event", {
      type: "snapshot",
      snapshot: this.snapshotDto(snapshot),
      hand: [],
      ...this.revealedHandsEventPart(snapshot)
    } satisfies GameEvent);
    this.sendTurnTimer(client, snapshot);
    this.sendPendingBotDecisionFailure(client);
  }

  private async handleLeave(client: Client): Promise<void> {
    // 观众离场:只清会话,不动牌桌与持久化
    if (this.spectatorSessions.delete(client.sessionId)) {
      return;
    }

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
        case "retry_bot_turn":
          this.handleRetryBotTurn(playerId);
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

  private handleRetryBotTurn(playerId: PlayerId): void {
    const player = this.table.snapshot().players.find((item) => item.id === playerId);
    if (!player || player.kind !== "human") {
      throw new Error("只有房间内真人玩家可以重新请求 AI 出牌。");
    }
    this.botController.retryManually();
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
              currentPlayerId: result.snapshot.currentPlayerId,
              initialHands: this.initialHandsPayload(result.snapshot)
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
      this.arenaDirector?.announceRoundStart();
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
            redealt: result.redealt,
            ...this.takeAiTracePayload(result.playerId)
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
      hand: this.handDtoFor(playerId)
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
            landlordId: result.landlordId,
            ...this.takeAiTracePayload(result.playerId)
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
      hand: this.handDtoFor(playerId)
    }));
    this.turnScheduler.scheduleTurnTimer(result.snapshot);
    this.turnScheduler.scheduleBotTurn(result.snapshot);
    if (result.decided && result.landlordId) {
      const nickname = this.nicknames.get(result.landlordId) ?? result.landlordId;
      this.arenaDirector?.fireCommentary("landlord", `${nickname} 成为地主,拿走 3 张底牌,当前 ${result.snapshot.multiplier} 倍`);
    }
  }

  private async afterPlay(play: PublicPlay): Promise<void> {
    const snapshot = this.table.snapshot();

    if (snapshot.phase === "settled" && snapshot.settlement) {
      const settlement = snapshot.settlement;
      await this.persistence.recordMutation({
        actions: [
          {
            type: "cards_played",
            playerId: play.playerId,
            payload: {
              cards: play.cards.map((card) => card.id),
              combination: play.combination.kind,
              ...this.takeAiTracePayload(play.playerId)
            }
          },
          {
            type: "round_settled",
            playerId: settlement.winnerId,
            payload: {
              settlement: toSettlementDto(settlement),
              // 参局 LLM bot 的模型身份,api 侧解析后写入 RoundPlayer.botProvider/botModel(规则 bot 不记)。
              ...(this.botIdentities.size > 0 ? { botPlayers: this.botPlayersPayload() } : {})
            }
          }
        ],
        snapshot
      });
      this.broadcastPersonalEvent((playerId) => ({
        type: "round_settled",
        settlement: toSettlementDto(settlement),
        snapshot: this.snapshotDto(snapshot),
        hand: this.handDtoFor(playerId),
        revealedHands: this.revealedHandsDto(snapshot)
      }));
      this.turnScheduler.cancelAll();
      const winnerName = this.nicknames.get(settlement.winnerId) ?? settlement.winnerId;
      this.arenaDirector?.fireCommentary(
        "settlement",
        `本局结束:${winnerName} 率先出完,${settlement.landlordWon ? "地主胜" : "农民胜"}${settlement.spring ? "(春天!)" : ""},${settlement.multiplier} 倍结算`
      );
      // 正常结算重置连续流局计数;竞技场按局间节奏自动开下一局
      this.arenaDirector?.onRoundSettled();
      return;
    }

    await this.persistence.recordMutation({
      actions: [
        {
          type: "cards_played",
          playerId: play.playerId,
          payload: {
            cards: play.cards.map((card) => card.id),
            combination: play.combination.kind,
            ...this.takeAiTracePayload(play.playerId)
          }
        }
      ],
      snapshot
    });
    this.broadcastPersonalEvent((playerId) => ({
      type: "cards_played",
      play: toPublicPlayDto(play),
      snapshot: this.snapshotDto(snapshot),
      hand: this.handDtoFor(playerId)
    }));
    this.turnScheduler.scheduleTurnTimer(snapshot);
    this.turnScheduler.scheduleBotTurn(snapshot);

    const playerName = this.nicknames.get(play.playerId) ?? play.playerId;
    if (play.combination.kind === "bomb" || play.combination.kind === "rocket") {
      this.arenaDirector?.fireCommentary(
        "bomb",
        `${playerName} 打出${combinationLabel(play.combination.kind)},倍数翻到 ${snapshot.multiplier} 倍`
      );
    } else {
      const remaining = snapshot.players.find((player) => player.id === play.playerId)?.handCount;
      if (remaining !== undefined && remaining <= 2) {
        this.arenaDirector?.fireCommentary("endgame", `${playerName} 打出${describeCombination(play.combination)},只剩 ${remaining} 张牌`);
      }
    }
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
            nextPlayerId: snapshot.currentPlayerId,
            ...this.takeAiTracePayload(playerId)
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

  private addBots(botCount: number, opts?: { readonly autoReady?: boolean; readonly lineup?: readonly ModelRef[] }): void {
    const lineup = opts?.lineup ?? null;
    // 竞技场:开局不在建房时 ready(交给 setupRoom 尾部的 readyBots 走完整 round_started 链路);真人房维持原语义
    const autoReady = opts?.autoReady ?? true;
    // 昵称:lineup 席位直接用模型名(观赏性的一部分),普通房生成可辨认的机器人昵称(与房内已有昵称去重)
    const names = lineup ? lineupBotNicknames(lineup) : pickBotNicknames(botCount, this.nicknames.values());
    for (let index = 0; index < botCount; index += 1) {
      const botId = `bot:${this.roomCode}:${index + 1}`;
      this.table.addBot(botId);
      this.nicknames.set(botId, names[index]!);
      if (autoReady) {
        const result = this.table.setReady(botId);
        if (result.roundStarted) {
          throw new Error("Bots cannot start a round before a human player joins.");
        }
      }
      this.botIds.push(botId);
      const model = lineup?.[index];
      if (model) {
        this.botBrains.set(botId, this.buildSeatBrain(model));
        this.botIdentities.set(botId, model);
      } else {
        this.registerBotBrain(botId);
      }
    }
  }

  /** 把当前房间级大脑与模型身份登记到该 bot 名下(真人房全部 bot 同一模型;竞技场按席位另行注入)。 */
  private registerBotBrain(botId: PlayerId): void {
    this.botBrains.set(botId, this.botBrain);
    if (this.botModel) {
      this.botIdentities.set(botId, this.botModel);
    } else {
      this.botIdentities.delete(botId);
    }
  }

  /** 为指定模型构建专属 LLM 大脑(竞技场席位/崩溃恢复共用);key 缺失直接抛错,绝不回退规则 bot。 */
  private buildSeatBrain(model: ModelRef): BotBrain {
    if (!this.botRegistry || !this.decisionConfig) {
      throw new Error("Bot registry is not initialized.");
    }
    return createBotBrain(
      {
        useLlm: true,
        model,
        timeoutMs: this.decisionConfig.timeoutMs,
        reasoningEffort: this.decisionConfig.reasoningEffort
      },
      this.botRegistry,
      this.botBrainHooks
    );
  }

  /** 任一席位是 LLM 大脑即用大模型档的展示倒计时。 */
  private usesLlmBotTimer(): boolean {
    return this.botBrain instanceof LlmBotBrain || [...this.botBrains.values()].some((brain) => brain instanceof LlmBotBrain);
  }

  /** playerId → {provider, model},只含 LLM bot。 */
  private botPlayersPayload(): Record<string, { provider: string; model: string }> {
    return Object.fromEntries(
      [...this.botIdentities].map(([playerId, ref]) => [playerId, { provider: ref.provider, model: ref.model }])
    );
  }

  /** 暂存成功决策的 trace 摘要,随后由该 bot 动作的 payload 取走落库(P2.5 写侧;失败结局不落)。 */
  private storePendingActionTrace(trace: LlmDecisionTrace): void {
    if (trace.outcome.kind !== "ok") {
      return;
    }
    this.pendingActionTraces.set(trace.playerId, {
      model: trace.modelId,
      latencyMs: trace.latencyMs,
      ...(trace.reasoningText ? { reasoningText: trace.reasoningText.slice(0, AI_TRACE_REASONING_MAX_CHARS) } : {}),
      ...(trace.usage ? { usage: trace.usage } : {})
    });
  }

  /** 取走该 bot 最近一次成功决策的摘要(消费一次即删);真人/规则 bot/超时代打永远为空。 */
  private takeAiTracePayload(playerId: PlayerId): Record<string, unknown> {
    const trace = this.pendingActionTraces.get(playerId);
    if (!trace) {
      return {};
    }
    this.pendingActionTraces.delete(playerId);
    return { aiTrace: trace };
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
    return toSnapshotDto(snapshot, this.nicknames, this.botIdentities);
  }

  /** 个性化事件中的手牌视角:入座玩家看自己的手牌,观众(null)无手牌。 */
  private handDtoFor(playerId: PlayerId | null) {
    return playerId === null ? [] : toCardsDto(this.table.getHand(playerId));
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

  private initialHandsPayload(snapshot: GameSnapshot): Record<string, string[]> {
    return Object.fromEntries(snapshot.players.map((player) => [player.id, this.table.getHand(player.id).map((card) => card.id)]));
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

  private sendPendingBotDecisionFailure(client: Client): void {
    const event = this.botController.pendingFailureEvent();
    if (event) {
      client.send("event", event);
    }
  }

  private broadcastPersonalSnapshot(type: "snapshot" | "round_started", snapshot: GameSnapshot): void {
    this.broadcastPersonalEvent((playerId) => ({
      type,
      snapshot: this.snapshotDto(snapshot),
      hand: this.handDtoFor(playerId),
      ...(type === "snapshot" ? this.revealedHandsEventPart(snapshot) : {})
    }));
  }

  private revealedHandsEventPart(snapshot: GameSnapshot): { readonly revealedHands?: RevealedHands } {
    return snapshot.phase === "settled" ? { revealedHands: this.revealedHandsDto(snapshot) } : {};
  }

  private sendRejected(client: Client, reason: string): void {
    client.send("event", {
      type: "command_rejected",
      reason
    } satisfies GameEvent);
  }

  /** 逐客户端发送个性化事件:入座玩家带各自视角(playerId),观众传 null(公开视角,无手牌)。 */
  private broadcastPersonalEvent(createEvent: (playerId: PlayerId | null) => GameEvent): void {
    for (const client of this.clients) {
      const playerId = this.clientPlayers.get(client.sessionId);
      if (playerId !== undefined) {
        client.send("event", createEvent(playerId));
      } else if (this.spectatorSessions.has(client.sessionId)) {
        client.send("event", createEvent(null));
      }
      // 其余会话(join 登记尚未完成)不发,与原实现一致
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
    const traceFile = this.traceSink ? ` trace=${this.traceSink.file}` : "";
    console.error(`[DdzRoom ${this.roomCode}] ${defaultReason} ${detail}${traceFile}`, error);

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
      this.roomClaimed = false;
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
