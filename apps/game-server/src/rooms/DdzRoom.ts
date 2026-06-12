import type { Client } from "@colyseus/core";
import { Room } from "@colyseus/core";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import { GameTable } from "@ddz/domain";
import { clientCommandSchema } from "@ddz/protocol";
import type { CardId, GameSnapshot, PlayerId, PublicPlay, ReadyResult } from "@ddz/domain";
import type { GameEvent } from "@ddz/protocol";
import type { GameActionClient } from "../api/gameActionClient.js";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { toCardsDto, toPublicPlayDto, toSettlementDto, toSnapshotDto } from "../dto.js";
import { decideBotAction } from "./botAction.js";
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
  botMoveDelayMs?: number;
  turnTimeoutMs?: number;
}

const DEFAULT_BOT_MOVE_DELAY_MS = 500;
const DEFAULT_TURN_TIMEOUT_MS = 20_000;
const QUICK_START_BOT_COUNT = 2;
// 结算后 bot 自动准备下一局的延迟，让结算事件先送达客户端
const SETTLEMENT_DISPLAY_MS = 5000;
// 撮合房创建后玩家迟迟未入场的自毁时限
const MATCHED_ROOM_EMPTY_TIMEOUT_MS = 60_000;
// 同一玩家新连接踢掉旧会话时使用的自定义关闭码
const DUPLICATE_SESSION_CLOSE_CODE = 4002;

export class DdzRoom extends Room {
  /** join 前 JWT 校验所需的配置，进程启动时注入。 */
  static authTokenConfig: TokenConfig | null = null;

  maxClients = 3;
  private readonly table = new GameTable();
  private readonly tasks = new SerialTaskQueue();
  private readonly clientPlayers = new Map<string, PlayerId>();
  private readonly playerSessions = new Map<PlayerId, Set<string>>();
  private persistence!: RoomPersistence;
  private turnScheduler!: RoomTurnScheduler;
  private roomCode!: string;
  private botMoveDelayMs = DEFAULT_BOT_MOVE_DELAY_MS;
  private botIds: PlayerId[] = [];
  /** 展示用昵称表（来自 JWT claims），快照下发时注入 */
  private readonly nicknames = new Map<PlayerId, string>();
  private turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS;
  private failed = false;

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
    this.botMoveDelayMs = readBotMoveDelayMs(options.botMoveDelayMs);
    this.turnTimeoutMs = readTurnTimeoutMs(options.turnTimeoutMs);
    this.roomCode = readRoomCode(options);
    this.persistence = new RoomPersistence(this.roomCode, options.roomStatusClient, options.gameActionClient);
    await this.persistence.requireJoinableRoom();
    const matchBotCount = readMatchBotCount(options.matchBotCount);
    const botCount =
      matchBotCount ?? (readQuickStart(options.quickStart) ? QUICK_START_BOT_COUNT : readBotCount(options.botCount));
    this.maxClients = 3 - botCount;
    this.addBots(botCount);
    if (matchBotCount !== null) {
      // 撮合房由服务端预创建；若玩家始终未入场则自毁，避免空房常驻
      this.clock.setTimeout(() => {
        if (this.clients.length === 0) {
          void this.disconnect();
        }
      }, MATCHED_ROOM_EMPTY_TIMEOUT_MS);
    }
    this.turnScheduler = new RoomTurnScheduler({
      botIds: this.botIds,
      botMoveDelayMs: this.botMoveDelayMs,
      clock: this.clock,
      enqueue: (task) => {
        void this.tasks.enqueue(task);
      },
      onBotTurn: (playerId) => this.handleBotTurn(playerId),
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
      turnTimeoutMs: this.turnTimeoutMs
    });
    this.setMetadata({
      roomCode: this.roomCode
    });
    this.setPrivate(false);
    this.onMessage("command", async (client, payload) => {
      await this.tasks.enqueue(() => this.handleCommand(client, payload));
    });
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    await this.tasks.enqueue(() => this.handleJoin(client, options));
  }

  async onLeave(client: Client): Promise<void> {
    await this.tasks.enqueue(() => this.handleLeave(client));
  }

  async onDispose(): Promise<void> {
    this.turnScheduler?.cancelAll();
    // failRoom 已上报 closed；onCreate 失败时 persistence 可能尚未初始化
    if (this.failed || !this.persistence) {
      return;
    }

    try {
      await this.persistence.closeRoom();
    } catch (error) {
      console.error(`[DdzRoom ${this.roomCode}] Failed to close room on dispose.`, error);
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
    if (claims.nickname) {
      this.nicknames.set(playerId, claims.nickname);
    }
    const reconnecting = this.table.hasPlayer(playerId);
    const seat = this.table.addPlayer(playerId);
    this.table.setConnected(playerId, true);
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
          await this.afterReady(this.table.setReady(playerId));
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
        hand: toCardsDto(this.table.getHand(playerId))
      }));
      this.turnScheduler.cancelAll();
      this.startNextRound();
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
    for (let index = 0; index < botCount; index += 1) {
      const botId = `bot:${this.roomCode}:${index + 1}`;
      this.table.addBot(botId);
      const result = this.table.setReady(botId);
      if (result.roundStarted) {
        throw new Error("Bots cannot start a round before a human player joins.");
      }
      this.botIds.push(botId);
    }
  }

  private async handleBotTurn(playerId: PlayerId): Promise<void> {
    const snapshot = this.table.snapshot();
    if (snapshot.currentPlayerId !== playerId) {
      return;
    }

    try {
      const action = decideBotAction(snapshot, playerId, this.table.getHand(playerId));
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
      throw new Error(error instanceof Error ? error.message : "Bot action failed.", {
        cause: error
      });
    }
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

  /** 结算画面停留一段时间后再重开下一局，否则客户端的结算界面会一闪而过。 */
  private startNextRound(): void {
    this.clock.setTimeout(() => {
      void this.tasks.enqueue(async () => {
        if (this.failed || this.table.snapshot().phase !== "settled") {
          return;
        }
        const snapshot = this.table.resetForNextRound();
        this.broadcastPersonalSnapshot("snapshot", snapshot);
        await this.readyBots();
      });
    }, SETTLEMENT_DISPLAY_MS);
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

    client.send("event", {
      type: "snapshot",
      snapshot: this.snapshotDto(this.table.snapshot()),
      hand: toCardsDto(this.table.getHand(playerId))
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
        hand: toCardsDto(this.table.getHand(playerId))
      } satisfies GameEvent);
    }
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

function readBotMoveDelayMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_BOT_MOVE_DELAY_MS;
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

  // 严格校验：只接受规范格式，不做 trim/toUpperCase 之类的静默修正
  if (!/^[A-Z0-9]{4,12}$/.test(value)) {
    throw new Error("Room code must be 4-12 uppercase letters or digits.");
  }

  return value;
}

function readPlayerKind(playerId: PlayerId, snapshot: GameSnapshot): "human" | "bot" {
  const player = snapshot.players.find((item) => item.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player.kind;
}
