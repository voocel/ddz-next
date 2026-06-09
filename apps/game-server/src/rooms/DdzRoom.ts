import type { Client } from "@colyseus/core";
import { Room } from "@colyseus/core";
import { verifyAccessToken, type TokenConfig } from "@ddz/auth";
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
}

interface RoomCreateOptions extends JoinOptions {
  tokenConfig: TokenConfig;
  roomStatusClient: RoomStatusClient;
  gameActionClient: GameActionClient;
  botCount?: number;
  botMoveDelayMs?: number;
  turnTimeoutMs?: number;
}

const DEFAULT_BOT_MOVE_DELAY_MS = 500;
const DEFAULT_TURN_TIMEOUT_MS = 20_000;

export class DdzRoom extends Room {
  maxClients = 3;
  private readonly table = new GameTable();
  private readonly tasks = new SerialTaskQueue();
  private readonly clientPlayers = new Map<string, PlayerId>();
  private readonly playerSessions = new Map<PlayerId, Set<string>>();
  private tokenConfig!: TokenConfig;
  private persistence!: RoomPersistence;
  private turnScheduler!: RoomTurnScheduler;
  private roomCode!: string;
  private botMoveDelayMs = DEFAULT_BOT_MOVE_DELAY_MS;
  private botIds: PlayerId[] = [];
  private turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS;

  async onCreate(options: RoomCreateOptions): Promise<void> {
    this.tokenConfig = options.tokenConfig;
    this.botMoveDelayMs = readBotMoveDelayMs(options.botMoveDelayMs);
    this.turnTimeoutMs = readTurnTimeoutMs(options.turnTimeoutMs);
    this.roomCode = readRoomCode(options);
    this.persistence = new RoomPersistence(this.roomCode, options.roomStatusClient, options.gameActionClient);
    await this.persistence.requireJoinableRoom();
    const botCount = readBotCount(options.botCount);
    this.maxClients = 3 - botCount;
    this.addBots(botCount);
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
          snapshot: toSnapshotDto(event.snapshot)
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

  private async handleJoin(client: Client, options: JoinOptions): Promise<void> {
    const accessToken = options.accessToken?.trim();
    if (!accessToken) {
      throw new Error("Access token is required to join the game room.");
    }

    const roomCode = parseRoomCode(options.roomCode);
    if (roomCode !== this.roomCode) {
      throw new Error(`Room code ${roomCode} does not match this game room.`);
    }

    const claims = verifyAccessToken(accessToken, this.tokenConfig);
    const playerId = claims.sub;
    const reconnecting = this.table.hasPlayer(playerId);
    const seat = this.table.addPlayer(playerId);
    this.table.setConnected(playerId, true);
    this.clientPlayers.set(client.sessionId, playerId);
    this.bindSession(playerId, client.sessionId);

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
        snapshot: toSnapshotDto(snapshot)
      } satisfies GameEvent);
    }

    this.sendSnapshot(client);
    this.turnScheduler.scheduleBotTurn(snapshot);
  }

  private async handleLeave(client: Client): Promise<void> {
    const playerId = this.clientPlayers.get(client.sessionId);
    if (!playerId) {
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
      snapshot: toSnapshotDto(this.table.snapshot())
    } satisfies GameEvent);
  }

  private async handleCommand(client: Client, payload: unknown): Promise<void> {
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
        playerId: result.playerId
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
      playerId: result.playerId
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
      snapshot: toSnapshotDto(result.snapshot),
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
      snapshot: toSnapshotDto(result.snapshot),
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
        snapshot: toSnapshotDto(snapshot),
        hand: toCardsDto(this.table.getHand(playerId))
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
        snapshot: toSnapshotDto(snapshot),
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
      snapshot: toSnapshotDto(snapshot)
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

  private sendSnapshot(client: Client): void {
    const playerId = this.clientPlayers.get(client.sessionId);
    if (!playerId) {
      return;
    }

    client.send("event", {
      type: "snapshot",
      snapshot: toSnapshotDto(this.table.snapshot()),
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
        snapshot: toSnapshotDto(snapshot),
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
    this.turnScheduler.cancelAll();
    let reason = error instanceof Error ? error.message : defaultReason;
    try {
      await this.persistence.closeFailedRoom(reason, this.table.snapshot());
    } catch (closeError) {
      const closeReason = closeError instanceof Error ? closeError.message : "Unknown room close error.";
      reason = `${reason}; failed to close room in API: ${closeReason}`;
      console.error(reason);
    }
    this.broadcast("event", {
      type: "room_failed",
      reason
    } satisfies GameEvent);
    await this.lock();
    await this.disconnect(1011);
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

  const roomCode = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(roomCode)) {
    throw new Error("Room code must be 4-12 uppercase letters or digits.");
  }

  return roomCode;
}

function readPlayerKind(playerId: PlayerId, snapshot: GameSnapshot): "human" | "bot" {
  const player = snapshot.players.find((item) => item.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player.kind;
}
