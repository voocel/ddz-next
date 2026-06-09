import { describe, expect, it } from "vitest";
import { AuthService, type AuthUserRecord, type CreateUserInput, type UserRepository } from "../src/auth/service";
import { GameActionService } from "../src/actions/service";
import {
  HistoryService,
  type CoinLedgerRecord,
  type HistoryRepository,
  type RoundHistoryRecord,
  type RoundReplayRecord
} from "../src/history/service";
import { RoomService } from "../src/rooms/service";
import { buildServer } from "../src/server";
import { InMemoryGameActionRepository } from "./actions/service.test";
import { InMemoryRoomRepository } from "./rooms/service.test";

const tokenConfig = {
  secret: "test-secret-that-is-long-enough",
  issuer: "ddz-api-test",
  audience: "ddz-web-test",
  accessTokenTtlSeconds: 3600
};

describe("API auth routes", () => {
  it("registers and logs in through HTTP routes", async () => {
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        username: "alice",
        nickname: "Alice",
        password: "secret123"
      }
    });

    expect(register.statusCode).toBe(200);
    expect(register.json()).toMatchObject({
      user: {
        username: "alice",
        nickname: "Alice"
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: "alice",
        password: "secret123"
      }
    });

    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toBeTruthy();

    await app.close();
  });

  it("returns 400 for invalid register payloads", async () => {
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        username: "a",
        nickname: "",
        password: "short"
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("creates, lists, and matches rooms through HTTP routes", async () => {
    const users = new InMemoryUserRepository();
    const app = buildServer({
      authService: new AuthService(users, tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        username: "room-user",
        nickname: "Room User",
        password: "secret123"
      }
    });
    const accessToken = register.json().accessToken as string;

    const anonymousCreate = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {
        code: "ROOM00"
      }
    });
    expect(anonymousCreate.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/rooms",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        code: "ROOM01"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().room.code).toBe("ROOM01");

    const list = await app.inject({
      method: "GET",
      url: "/rooms"
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().rooms).toHaveLength(1);

    const matched = await app.inject({
      method: "POST",
      url: "/rooms/match",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(matched.statusCode).toBe(200);
    expect(matched.json().room.code).toBe("ROOM01");

    const anonymousMatch = await app.inject({
      method: "POST",
      url: "/rooms/match"
    });
    expect(anonymousMatch.statusCode).toBe(401);

    await app.close();
  });

  it("protects internal room status updates", async () => {
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const anonymousJoinable = await app.inject({
      method: "GET",
      url: "/internal/rooms/ROOM02/joinable"
    });
    expect(anonymousJoinable.statusCode).toBe(401);

    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        username: "internal-room-user",
        nickname: "Internal Room",
        password: "secret123"
      }
    });

    await app.inject({
      method: "POST",
      url: "/rooms",
      headers: {
        authorization: `Bearer ${register.json().accessToken as string}`
      },
      payload: {
        code: "ROOM02"
      }
    });

    const joinable = await app.inject({
      method: "GET",
      url: "/internal/rooms/ROOM02/joinable",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      }
    });
    expect(joinable.statusCode).toBe(200);
    expect(joinable.json().room.code).toBe("ROOM02");

    const rejected = await app.inject({
      method: "PATCH",
      url: "/internal/rooms/ROOM02/status",
      payload: {
        status: "playing"
      }
    });
    expect(rejected.statusCode).toBe(401);

    const updated = await app.inject({
      method: "PATCH",
      url: "/internal/rooms/ROOM02/status",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      payload: {
        status: "playing"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().room.status).toBe("playing");

    const noLongerJoinable = await app.inject({
      method: "GET",
      url: "/internal/rooms/ROOM02/joinable",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      }
    });
    expect(noLongerJoinable.statusCode).toBe(404);

    await app.close();
  });

  it("protects internal game action writes", async () => {
    const actionRepository = new InMemoryGameActionRepository();
    actionRepository.rooms.set("ROOM03", "room-3");
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(actionRepository),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/internal/game-actions",
      payload: {
        roomCode: "ROOM03",
        mutationId: "00000000-0000-4000-8000-000000000101",
        actions: [
          {
            playerId: "user-1",
            playerKind: "human",
            type: "player_joined",
            payload: {}
          }
        ]
      }
    });
    expect(rejected.statusCode).toBe(401);

    const recorded = await app.inject({
      method: "POST",
      url: "/internal/game-actions",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      payload: {
        roomCode: "ROOM03",
        mutationId: "00000000-0000-4000-8000-000000000102",
        actions: [
          {
            playerId: "user-1",
            playerKind: "human",
            type: "player_joined",
            payload: {
              seat: 0
            }
          }
        ]
      }
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({
      roomEventIds: ["room-event-1"],
      actionIds: [],
      roundId: null
    });

    await app.close();
  });

  it("returns authenticated player round history and coin ledgers", async () => {
    const users = new InMemoryUserRepository();
    const history = new InMemoryHistoryRepository();
    const app = buildServer({
      authService: new AuthService(users, tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(history),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        username: "history-user",
        nickname: "History",
        password: "secret123"
      }
    });
    const accessToken = register.json().accessToken as string;
    const userId = register.json().user.id as string;

    history.rounds.set(userId, [
      {
        id: "round-1",
        room: {
          code: "ROOM99"
        },
        landlordId: userId,
        startedAt: new Date(Date.UTC(2026, 0, 1, 10)),
        endedAt: new Date(Date.UTC(2026, 0, 1, 10, 5)),
        players: [
          { playerId: userId, playerKind: "human", seat: 0, score: 2, coinDelta: 2 },
          { playerId: "other-1", playerKind: "human", seat: 1, score: -1, coinDelta: -1 },
          { playerId: "bot:ROOM99:1", playerKind: "bot", seat: 2, score: -1, coinDelta: -1 }
        ]
      }
    ]);
    history.replays.set(`${userId}:round-1`, {
      id: "round-1",
      room: {
        code: "ROOM99"
      },
      landlordId: userId,
      startedAt: new Date(Date.UTC(2026, 0, 1, 10)),
      endedAt: new Date(Date.UTC(2026, 0, 1, 10, 5)),
      players: [
        { playerId: userId, playerKind: "human", seat: 0, score: 2, coinDelta: 2 },
        { playerId: "other-1", playerKind: "human", seat: 1, score: -1, coinDelta: -1 },
        { playerId: "bot:ROOM99:1", playerKind: "bot", seat: 2, score: -1, coinDelta: -1 }
      ],
      actions: [
        {
          id: "action-1",
          type: "round_settled",
          playerId: userId,
          playerKind: "human",
          payload: {
            winnerId: userId,
            snapshot: {
              phase: "settled",
              players: [
                { id: userId, kind: "human", seat: 0, ready: false, handCount: 0, connected: true, score: 2 },
                { id: "other-1", kind: "human", seat: 1, ready: false, handCount: 3, connected: true, score: -1 },
                { id: "bot:ROOM99:1", kind: "bot", seat: 2, ready: false, handCount: 4, connected: true, score: -1 }
              ],
              currentPlayerId: null,
              landlordId: userId,
              bidCandidateId: userId,
              landlordCards: [],
              lastPlay: null,
              passCount: 0,
              settlement: {
                winnerId: userId,
                landlordId: userId,
                landlordWon: true,
                baseScore: 1,
                players: [
                  { playerId: userId, seat: 0, role: "landlord", handCount: 0, scoreDelta: 2, totalScore: 2 },
                  { playerId: "other-1", seat: 1, role: "farmer", handCount: 3, scoreDelta: -1, totalScore: -1 },
                  { playerId: "bot:ROOM99:1", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
                ]
              }
            }
          },
          createdAt: new Date(Date.UTC(2026, 0, 1, 10, 5))
        }
      ]
    });
    history.ledgers.set(userId, [
      {
        id: "ledger-1",
        roundId: "round-1",
        roomCode: "ROOM99",
        delta: 2,
        balance: 1002,
        reason: "round_settled",
        createdAt: new Date(Date.UTC(2026, 0, 1, 10, 5))
      }
    ]);

    const rejected = await app.inject({
      method: "GET",
      url: "/me/rounds"
    });
    expect(rejected.statusCode).toBe(401);

    const rounds = await app.inject({
      method: "GET",
      url: "/me/rounds",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(rounds.statusCode).toBe(200);
    expect(rounds.json().rounds[0]).toMatchObject({
      id: "round-1",
      roomCode: "ROOM99",
      landlordId: userId
    });

    const replay = await app.inject({
      method: "GET",
      url: "/me/rounds/round-1",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().round.actions).toEqual([
      expect.objectContaining({
        id: "action-1",
        type: "round_settled",
        playerId: userId,
        playerKind: "human",
        payload: expect.objectContaining({
          snapshot: expect.objectContaining({
            phase: "settled",
            players: expect.arrayContaining([
              expect.objectContaining({
                id: "bot:ROOM99:1",
                kind: "bot"
              })
            ]),
            settlement: expect.objectContaining({
              winnerId: userId
            })
          })
        })
      })
    ]);

    const missingReplay = await app.inject({
      method: "GET",
      url: "/me/rounds/round-missing",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(missingReplay.statusCode).toBe(404);

    const ledgers = await app.inject({
      method: "GET",
      url: "/me/coin-ledgers",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(ledgers.statusCode).toBe(200);
    expect(ledgers.json().ledgers[0]).toMatchObject({
      id: "ledger-1",
      delta: 2,
      balance: 1002
    });

    await app.close();
  });
});

class InMemoryUserRepository implements UserRepository {
  readonly records: AuthUserRecord[] = [];

  async findByUsername(username: string): Promise<AuthUserRecord | null> {
    return this.records.find((record) => record.username === username) ?? null;
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRecord> {
    const record = {
      id: `user-${this.records.length + 1}`,
      username: input.username,
      nickname: input.nickname,
      passwordHash: input.passwordHash
    };
    this.records.push(record);
    return record;
  }
}

class InMemoryHistoryRepository implements HistoryRepository {
  readonly rounds = new Map<string, readonly RoundHistoryRecord[]>();
  readonly replays = new Map<string, RoundReplayRecord>();
  readonly ledgers = new Map<string, readonly CoinLedgerRecord[]>();

  async listRoundsByUserId(userId: string): Promise<readonly RoundHistoryRecord[]> {
    return this.rounds.get(userId) ?? [];
  }

  async listCoinLedgersByUserId(userId: string): Promise<readonly CoinLedgerRecord[]> {
    return this.ledgers.get(userId) ?? [];
  }

  async findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null> {
    return this.replays.get(`${userId}:${roundId}`) ?? null;
  }
}
