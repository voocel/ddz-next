import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GameTable, type PlayerId } from "@ddz/domain";
import type { RoomLiveStateEnvelope } from "@ddz/protocol";
import type { BotAction, BotBrain } from "../../src/rooms/botBrain";
import { DdzRoom } from "../../src/rooms/DdzRoom";
import { LlmDecisionError } from "../../src/rooms/llmBotBrain";
import type { RoomPersistence } from "../../src/rooms/roomPersistence";
import { SerialTaskQueue } from "../../src/rooms/serialTaskQueue";

describe("DdzRoom bot decision failure", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("keeps the room open, shows the LLM error, and lets a human retry the same bot turn", async () => {
    const fixture = createFixture();
    const firstError = new LlmDecisionError("request_error", "LLM 请求失败: 上游限流", 128);
    fixture.botBrain.decide.mockRejectedValueOnce(firstError).mockResolvedValueOnce({ type: "pass" } satisfies BotAction);

    await fixture.handleBotTurn(fixture.botId, () => true);

    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({
        type: "bot_decision_failed",
        playerId: fixture.botId,
        message: "LLM 请求失败: 上游限流",
        retryable: true
      })
    );
    expect(fixture.broadcast).not.toHaveBeenCalledWith("event", expect.objectContaining({ type: "room_failed" }));
    expect(fixture.closeFailedRoom).not.toHaveBeenCalled();
    expect(fixture.botBrain.decide).toHaveBeenCalledTimes(1);

    await fixture.handleCommand(fixture.client, { type: "retry_bot_turn" });
    await vi.waitFor(() => {
      expect(fixture.botBrain.decide).toHaveBeenCalledTimes(2);
      expect(fixture.recordMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [expect.objectContaining({ type: "player_passed", playerId: fixture.botId })]
        })
      );
    });

    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "player_passed", playerId: fixture.botId })
    );
    expect(fixture.closeFailedRoom).not.toHaveBeenCalled();
  });

  it("失败广播携带 attempt/willRetry,退避回调自动重试成功后正常落子", async () => {
    const fixture = createFixture();
    const error = new LlmDecisionError("request_error", "上游超时", 100);
    fixture.botBrain.decide.mockRejectedValueOnce(error).mockResolvedValueOnce({ type: "pass" } satisfies BotAction);

    await fixture.handleBotTurn(fixture.botId, () => true);

    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "bot_decision_failed", attempt: 1, willRetry: true })
    );

    // 测试环境的 Colyseus clock 未启动,直接触发退避回调
    fixture.invoke("autoRetryBotTurn", fixture.botId);
    await vi.waitFor(() => {
      expect(fixture.botBrain.decide).toHaveBeenCalledTimes(2);
      expect(fixture.recordMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [expect.objectContaining({ type: "player_passed", playerId: fixture.botId })]
        })
      );
    });
    expect(fixture.closeFailedRoom).not.toHaveBeenCalled();
  });

  it("真人房重试耗尽:willRetry=false,等待手动重试,不流局不关房", async () => {
    const fixture = createFixture();
    (fixture.internals.botRetryAttempts as Map<string, number>).set(fixture.botId, 2);
    fixture.botBrain.decide.mockRejectedValueOnce(new LlmDecisionError("request_error", "上游宕机", 100));

    await fixture.handleBotTurn(fixture.botId, () => true);

    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "bot_decision_failed", attempt: 3, willRetry: false, retryable: true })
    );
    expect(fixture.recordMutation).not.toHaveBeenCalled();
    expect(fixture.closeFailedRoom).not.toHaveBeenCalled();
    expect(fixture.internals.pendingBotDecisionFailure).toMatchObject({ playerId: fixture.botId });
    expect(fixture.table.snapshot().phase).toBe("playing");
  });

  it("竞技场重试耗尽:流局落库+广播,牌桌回到 ready 等下一局", async () => {
    const fixture = createFixture();
    fixture.internals.arena = true;
    (fixture.internals.botRetryAttempts as Map<string, number>).set(fixture.botId, 2);
    fixture.botBrain.decide.mockRejectedValueOnce(new LlmDecisionError("request_error", "上游宕机", 100));

    await fixture.handleBotTurn(fixture.botId, () => true);

    await vi.waitFor(() => {
      expect(fixture.recordMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: [
            expect.objectContaining({
              type: "round_aborted",
              playerId: fixture.botId,
              payload: expect.objectContaining({
                failedPlayerId: fixture.botId,
                players: expect.arrayContaining([expect.objectContaining({ playerId: "human-1", seat: 0 })])
              })
            })
          ]
        })
      );
    });
    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "round_aborted", failedPlayerId: fixture.botId })
    );
    expect(fixture.table.snapshot().phase).toBe("ready");
    expect(fixture.closeFailedRoom).not.toHaveBeenCalled();
    expect(fixture.internals.arenaConsecutiveAborts).toBe(1);
  });

  it("竞技场连续第二次流局:failRoom 止损", async () => {
    const fixture = createFixture();
    fixture.internals.arena = true;
    fixture.internals.arenaConsecutiveAborts = 1;
    fixture.internals.lock = vi.fn(async () => {});
    fixture.internals.disconnect = vi.fn(async () => {});
    (fixture.internals.botRetryAttempts as Map<string, number>).set(fixture.botId, 2);
    fixture.botBrain.decide.mockRejectedValueOnce(new LlmDecisionError("request_error", "上游宕机", 100));

    await fixture.handleBotTurn(fixture.botId, () => true);

    await vi.waitFor(() => {
      expect(fixture.closeFailedRoom).toHaveBeenCalledTimes(1);
    });
    expect(fixture.broadcast).toHaveBeenCalledWith("event", expect.objectContaining({ type: "room_failed" }));
  });
});

interface Fixture {
  readonly botId: string;
  readonly botBrain: { readonly decide: ReturnType<typeof vi.fn> };
  readonly broadcast: ReturnType<typeof vi.fn>;
  readonly client: { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> };
  readonly closeFailedRoom: ReturnType<typeof vi.fn>;
  readonly handleBotTurn: (playerId: PlayerId, isValid: () => boolean) => Promise<void>;
  readonly handleCommand: (client: { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> }, payload: unknown) => Promise<void>;
  readonly recordMutation: ReturnType<typeof vi.fn>;
  readonly internals: Record<string, unknown>;
  readonly table: GameTable;
  readonly invoke: (method: string, ...args: unknown[]) => unknown;
}

function createFixture(): Fixture {
  const room = new DdzRoom();
  const table = playingTable();
  const botId = table.snapshot().currentPlayerId!;
  const botBrain = {
    decide: vi.fn()
  };
  const broadcast = vi.fn();
  const recordMutation = vi.fn(async () => {});
  const closeFailedRoom = vi.fn(async () => {});
  const client = { sessionId: "session-human-1", send: vi.fn() };
  const internals = room as unknown as Record<string, unknown>;

  internals.roomCode = "100031";
  internals.table = table;
  internals.tasks = new SerialTaskQueue();
  internals.botIds = [botId, "bot:100031:2"];
  internals.botBrains = new Map<PlayerId, BotBrain>([
    [botId, botBrain satisfies BotBrain],
    ["bot:100031:2", botBrain satisfies BotBrain]
  ]);
  internals.clientPlayers = new Map([[client.sessionId, "human-1"]]);
  internals.playerSessions = new Map([["human-1", new Set([client.sessionId])]]);
  internals.nicknames = new Map([
    ["human-1", "Alice"],
    [botId, "Bot A"],
    ["bot:100031:2", "Bot B"]
  ]);
  internals.broadcast = broadcast;
  internals.persistence = {
    recordMutation,
    closeFailedRoom
  } satisfies Pick<RoomPersistence, "recordMutation" | "closeFailedRoom">;
  internals.turnScheduler = {
    scheduleTurnTimer: vi.fn(),
    scheduleBotTurn: vi.fn(),
    cancelAll: vi.fn()
  };
  internals.streamBuffers = new Map();
  internals.botDecisionInFlight = new Set();
  internals.pendingBotDecisionFailure = null;
  internals.failed = false;

  return {
    botId,
    botBrain,
    broadcast,
    client,
    closeFailedRoom,
    handleBotTurn: (playerId, isValid) =>
      (room as unknown as { handleBotTurn(playerId: PlayerId, isValid: () => boolean): Promise<void> }).handleBotTurn(
        playerId,
        isValid
      ),
    handleCommand: (commandClient, payload) =>
      (room as unknown as { handleCommand(client: unknown, payload: unknown): Promise<void> }).handleCommand(
        commandClient,
        payload
      ),
    recordMutation,
    internals,
    table,
    invoke: (method, ...args) => (room as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!(...args)
  };
}

function playingTable(): GameTable {
  const table = new GameTable();
  table.restore({
    phase: "playing",
    players: [
      {
        id: "human-1",
        kind: "human",
        seat: 0,
        ready: false,
        connected: true,
        hand: ["3-diamonds"],
        score: 0
      },
      {
        id: "bot:100031:1",
        kind: "bot",
        seat: 1,
        ready: false,
        connected: true,
        hand: ["4-diamonds"],
        score: 0
      },
      {
        id: "bot:100031:2",
        kind: "bot",
        seat: 2,
        ready: false,
        connected: true,
        hand: ["5-diamonds"],
        score: 0
      }
    ],
    currentPlayerId: "bot:100031:1",
    landlordId: "human-1",
    bidCandidateId: null,
    firstBidderId: null,
    landlordCards: ["6-diamonds", "7-diamonds", "8-diamonds"],
    bottomCards: [],
    lastPlay: {
      playerId: "human-1",
      cards: ["3-diamonds"]
    },
    settlement: null,
    passCount: 0,
    bidAttempts: 0,
    robQueue: [],
    robIndex: 0,
    robCount: 0,
    bombCount: 0,
    playCounts: {
      "human-1": 1
    },
    playHistory: [{ type: "play", playerId: "human-1", cards: ["3-diamonds"] }]
  } satisfies RoomLiveStateEnvelope["table"]);
  return table;
}
