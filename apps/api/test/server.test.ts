import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/service";
import { GameActionService } from "../src/actions/service";
import { HistoryService } from "../src/history/service";
import { LeaderboardService } from "../src/leaderboard/service";
import { RoomService } from "../src/rooms/service";
import { buildServer } from "../src/server";
import {
  InMemoryGameActionRepository,
  InMemoryHistoryRepository,
  InMemoryLeaderboardRepository,
  InMemoryRoomRepository,
  InMemoryUserRepository
} from "./helpers";

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
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
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
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
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
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
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
        code: "100000"
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
        code: "100001"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().room.code).toBe("100001");

    const list = await app.inject({
      method: "GET",
      url: "/rooms"
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().rooms).toHaveLength(1);

    // 公开查房：直连 /table/:code 分享链接的入口
    const fetched = await app.inject({
      method: "GET",
      url: "/rooms/100001"
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().room.code).toBe("100001");

    const missing = await app.inject({
      method: "GET",
      url: "/rooms/999999"
    });
    expect(missing.statusCode).toBe(404);

    const invalidCode = await app.inject({
      method: "GET",
      url: "/rooms/not-a-code"
    });
    expect(invalidCode.statusCode).toBe(400);

    // 竞技场房不进普通大厅列表，走 /arena/rooms 直播列表
    const arenaCreated = await app.inject({
      method: "POST",
      url: "/rooms",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        code: "100002",
        mode: "arena"
      }
    });
    expect(arenaCreated.statusCode).toBe(200);
    expect(arenaCreated.json().room.mode).toBe("arena");

    const listAfterArena = await app.inject({
      method: "GET",
      url: "/rooms"
    });
    expect(listAfterArena.json().rooms.map((room: { code: string }) => room.code)).toEqual(["100001"]);

    const arenaList = await app.inject({
      method: "GET",
      url: "/arena/rooms"
    });
    expect(arenaList.statusCode).toBe(200);
    expect(arenaList.json().rooms.map((room: { code: string }) => room.code)).toEqual(["100002"]);

    const internalCreated = await app.inject({
      method: "POST",
      url: "/internal/rooms",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      }
    });
    expect(internalCreated.statusCode).toBe(200);
    expect(internalCreated.json().room.status).toBe("open");

    const anonymousInternalCreate = await app.inject({
      method: "POST",
      url: "/internal/rooms"
    });
    expect(anonymousInternalCreate.statusCode).toBe(401);

    await app.close();
  });

  it("serves the public model leaderboard", async () => {
    const leaderboard = new InMemoryLeaderboardRepository();
    leaderboard.rows.push(
      {
        playerId: "bot:1",
        score: 4,
        botProvider: "anthropic",
        botModel: "model-a",
        landlordId: "bot:1",
        abortReason: null,
        failedPlayerId: null,
        endedAt: new Date()
      },
      {
        playerId: "bot:2",
        score: -2,
        botProvider: "openai",
        botModel: "model-b",
        landlordId: "bot:1",
        abortReason: null,
        failedPlayerId: null,
        endedAt: new Date()
      }
    );
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      leaderboardService: new LeaderboardService(leaderboard),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/leaderboard"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries.map((entry: { model: string }) => entry.model)).toEqual(["model-a", "model-b"]);

    await app.close();
  });

  it("protects internal room status updates", async () => {
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

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
        code: "100002"
      }
    });

    const rejected = await app.inject({
      method: "PATCH",
      url: "/internal/rooms/100002/status",
      payload: {
        status: "playing"
      }
    });
    expect(rejected.statusCode).toBe(401);

    const updated = await app.inject({
      method: "PATCH",
      url: "/internal/rooms/100002/status",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      payload: {
        ownerId: "owner-1",
        status: "playing"
      }
    });
    expect(updated.statusCode).toBe(409);

    const claimed = await app.inject({
      method: "POST",
      url: "/internal/rooms/100002/claim",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      payload: {
        ownerId: "owner-1",
        ttlMs: 60_000
      }
    });
    expect(claimed.statusCode).toBe(200);

    const updatedAfterClaim = await app.inject({
      method: "PATCH",
      url: "/internal/rooms/100002/status",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      payload: {
        ownerId: "owner-1",
        status: "playing"
      }
    });
    expect(updatedAfterClaim.statusCode).toBe(200);
    expect(updatedAfterClaim.json().room.status).toBe("playing");

    // 崩溃恢复查询：无 token 拒绝；有 token 返回房间与状态（无状态行时为 null）
    const anonymousState = await app.inject({
      method: "GET",
      url: "/internal/rooms/100002/state"
    });
    expect(anonymousState.statusCode).toBe(401);

    const state = await app.inject({
      method: "GET",
      url: "/internal/rooms/100002/state",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      }
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().room.code).toBe("100002");
    expect(state.json().state).toBeNull();

    await app.close();
  });

  it("protects internal game action writes", async () => {
    const actionRepository = new InMemoryGameActionRepository();
    actionRepository.seedRoom("100003", "room-3");
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(actionRepository),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/internal/game-actions",
      payload: {
        roomCode: "100003",
        ownerId: "owner-1",
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
        roomCode: "100003",
        ownerId: "owner-1",
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
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
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
          code: "100099"
        },
        landlordId: userId,
        startedAt: new Date(Date.UTC(2026, 0, 1, 10)),
        endedAt: new Date(Date.UTC(2026, 0, 1, 10, 5)),
        players: [
          { playerId: userId, playerKind: "human", seat: 0, score: 2, coinDelta: 2 },
          { playerId: "other-1", playerKind: "human", seat: 1, score: -1, coinDelta: -1 },
          { playerId: "bot:100099:1", playerKind: "bot", seat: 2, score: -1, coinDelta: -1 }
        ]
      }
    ]);
    history.replays.set(`${userId}:round-1`, {
      id: "round-1",
      room: {
        code: "100099"
      },
      landlordId: userId,
      startedAt: new Date(Date.UTC(2026, 0, 1, 10)),
      endedAt: new Date(Date.UTC(2026, 0, 1, 10, 5)),
      players: [
        { playerId: userId, playerKind: "human", seat: 0, score: 2, coinDelta: 2 },
        { playerId: "other-1", playerKind: "human", seat: 1, score: -1, coinDelta: -1 },
        { playerId: "bot:100099:1", playerKind: "bot", seat: 2, score: -1, coinDelta: -1 }
      ],
      actions: [
        {
          id: "action-0",
          seq: 1,
          type: "round_started",
          playerId: null,
          playerKind: null,
          payload: {
            currentPlayerId: userId,
            initialHands: {
              [userId]: ["3-clubs", "SJ"],
              "other-1": ["4-hearts"],
              "bot:100099:1": ["5-spades"]
            }
          },
          createdAt: new Date(Date.UTC(2026, 0, 1, 10, 0, 1))
        },
        {
          id: "action-1",
          seq: 2,
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
                { id: "bot:100099:1", kind: "bot", seat: 2, ready: false, handCount: 4, connected: true, score: -1 }
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
                  { playerId: "bot:100099:1", seat: 2, role: "farmer", handCount: 4, scoreDelta: -1, totalScore: -1 }
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
        roomCode: "100099",
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
      roomCode: "100099",
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
    expect(replay.json().round.viewerInitialHand).toEqual([
      { id: "3-clubs", rank: "3", suit: "clubs" },
      { id: "SJ", rank: "SJ" }
    ]);
    expect(JSON.stringify(replay.json().round.viewerInitialHand)).not.toContain("4-hearts");
    expect(replay.json().round.actions).toEqual([
      expect.objectContaining({
        id: "action-0",
        seq: 1,
        type: "round_started"
      }),
      expect.objectContaining({
        id: "action-1",
        seq: 2,
        type: "round_settled",
        playerId: userId,
        playerKind: "human",
        payload: expect.objectContaining({
          snapshot: expect.objectContaining({
            phase: "settled",
            players: expect.arrayContaining([
              expect.objectContaining({
                id: "bot:100099:1",
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

  it("rate limits repeated auth requests", async () => {
    const app = buildServer({
      authService: new AuthService(new InMemoryUserRepository(), tokenConfig),
      roomService: new RoomService(new InMemoryRoomRepository()),
      gameActionService: new GameActionService(new InMemoryGameActionRepository()),
      historyService: new HistoryService(new InMemoryHistoryRepository()),
      leaderboardService: new LeaderboardService(new InMemoryLeaderboardRepository()),
      tokenConfig,
      internalConfig: {
        token: "internal-test-token"
      }
    });

    let lastStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          username: "alice",
          password: "wrong-password"
        }
      });
      lastStatus = response.statusCode;
    }

    expect(lastStatus).toBe(429);

    await app.close();
  });
});
