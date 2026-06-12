import { matchMaker, Room, type Client } from "@colyseus/core";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import { DUPLICATE_SESSION_CLOSE_CODE, type MatchmakingEvent } from "@ddz/protocol";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { InMemoryMatchQueue, planMatchSize, type MatchQueue, type MatchQueueEntry } from "../matchmaking/matchQueue.js";

interface MatchmakingCreateOptions {
  readonly roomStatusClient: RoomStatusClient;
  readonly matchTimeoutMs?: number;
  readonly checkIntervalMs?: number;
}

interface JoinOptions {
  readonly accessToken?: string;
}

const DEFAULT_MATCH_TIMEOUT_MS = 8_000;
const DEFAULT_CHECK_INTERVAL_MS = 1_000;

/**
 * 全局匹配房：玩家加入即入队，凑满 3 真人立即开局，
 * 队首等待超时则按现有人数补 bot 开局。离开即出队（取消匹配）。
 */
export class MatchmakingRoom extends Room {
  static authTokenConfig: TokenConfig | null = null;

  private readonly queue: MatchQueue = new InMemoryMatchQueue();
  private roomStatusClient!: RoomStatusClient;
  private matchTimeoutMs = DEFAULT_MATCH_TIMEOUT_MS;
  private matching = false;

  static override async onAuth(token: string, options: JoinOptions | undefined): Promise<AccessTokenClaims> {
    if (!MatchmakingRoom.authTokenConfig) {
      throw new Error("Token config is not configured for MatchmakingRoom.");
    }

    const accessToken = options?.accessToken?.trim() || token;
    if (!accessToken) {
      throw new Error("Access token is required to join matchmaking.");
    }

    return verifyAccessToken(accessToken, MatchmakingRoom.authTokenConfig);
  }

  onCreate(options: MatchmakingCreateOptions): void {
    this.roomStatusClient = options.roomStatusClient;
    this.matchTimeoutMs = options.matchTimeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS;
    // 注意：不能 setPrivate，否则 joinOrCreate 找不到现存实例，玩家会被分进多个队列
    this.clock.setInterval(() => {
      void this.tick();
    }, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);
  }

  async onJoin(client: Client): Promise<void> {
    const claims = client.auth as AccessTokenClaims | undefined;
    if (!claims?.sub) {
      throw new Error("Authenticated player id is required for matchmaking.");
    }

    // 同玩家的旧会话踢出（双开或断线重连），队列条目由 enqueue 去重替换
    for (const other of this.clients) {
      if (other.sessionId !== client.sessionId && (other.auth as AccessTokenClaims | undefined)?.sub === claims.sub) {
        other.leave(DUPLICATE_SESSION_CLOSE_CODE);
      }
    }

    await this.queue.enqueue({
      playerId: claims.sub,
      sessionId: client.sessionId,
      enqueuedAt: Date.now()
    });
    await this.broadcastQueueStatus();
    // 入队即尝试撮合，凑满 3 人不必等下一个 tick
    void this.tick();
  }

  async onLeave(client: Client): Promise<void> {
    await this.queue.removeBySession(client.sessionId);
    await this.broadcastQueueStatus();
  }

  private async tick(): Promise<void> {
    if (this.matching) {
      return;
    }

    this.matching = true;
    try {
      // 一轮可能撮合出多桌（如 6 人同时在队）
      for (;;) {
        const size = await this.queue.size();
        const oldestWaitMs = await this.queue.oldestWaitMs(Date.now());
        const takeCount = planMatchSize(size, oldestWaitMs, this.matchTimeoutMs);
        if (takeCount === 0) {
          return;
        }

        const entries = await this.queue.take(takeCount);
        if (!entries.length) {
          return;
        }
        await this.createMatch(entries);
      }
    } finally {
      this.matching = false;
    }
  }

  private async createMatch(entries: readonly MatchQueueEntry[]): Promise<void> {
    try {
      const room = await this.roomStatusClient.createRoom();
      await matchMaker.createRoom("ddz", {
        roomCode: room.code,
        matchBotCount: 3 - entries.length
      });
      this.sendToEntries(entries, {
        type: "matched",
        room
      });
      await this.broadcastQueueStatus();
    } catch (error) {
      console.error("[Matchmaking] Failed to create match, requeueing players.", error);
      await this.queue.requeueFront(entries);
      this.sendToEntries(entries, {
        type: "match_failed",
        message: "匹配失败，正在重试"
      });
    }
  }

  private sendToEntries(entries: readonly MatchQueueEntry[], event: MatchmakingEvent): void {
    for (const entry of entries) {
      this.clients.getById(entry.sessionId)?.send("matchmaking", event);
    }
  }

  private async broadcastQueueStatus(): Promise<void> {
    const positions = await this.queue.positions();
    for (const client of this.clients) {
      const position = positions.get(client.sessionId);
      if (position !== undefined) {
        client.send("matchmaking", {
          type: "queue_status",
          waiting: positions.size,
          position
        } satisfies MatchmakingEvent);
      }
    }
  }
}
