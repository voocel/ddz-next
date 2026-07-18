import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBotProviderRegistry } from "@ddz/bot-ai";
import { GameTable } from "@ddz/domain";
import { DdzRoom } from "../../src/rooms/DdzRoom";
import { SerialTaskQueue } from "../../src/rooms/serialTaskQueue";
import { createRoomFixture, restoreEnv, runtimeEnv, setEnv, stateResponse } from "./roomCreateFixture";

const originalAiBattleEnabled = runtimeEnv().AI_BATTLE_ENABLED;
const originalAiBattleMaxActive = runtimeEnv().AI_BATTLE_MAX_ACTIVE;

const registry = parseBotProviderRegistry(
  JSON.stringify({
    provider: "anthropic",
    model: "model-a",
    providers: {
      anthropic: { type: "anthropic", api_key: "test-key", models: ["model-a", "model-b"] }
    }
  })
);

const lineup = [
  { provider: "anthropic", model: "model-a" },
  { provider: "anthropic", model: "model-b" },
  { provider: "anthropic", model: "model-a" }
];

describe("DdzRoom arena", () => {
  beforeEach(() => {
    setEnv("AI_BATTLE_ENABLED", "true");
    setEnv("AI_BATTLE_MAX_ACTIVE", "5");
  });

  afterEach(() => {
    restoreEnv("AI_BATTLE_ENABLED", originalAiBattleEnabled);
    restoreEnv("AI_BATTLE_MAX_ACTIVE", originalAiBattleMaxActive);
  });

  it("竞技场建房:3 席位按阵容装配独立身份,无真人自动开局到叫地主", async () => {
    const code = "100041";
    const fixture = createRoomFixture(code, stateResponse(code, "open", null), {
      arena: true,
      lineup,
      botRegistry: registry
    });

    await fixture.room.onCreate(fixture.options);
    await fixture.flushTasks();

    const internals = fixture.internals() as unknown as Record<string, unknown>;
    expect(fixture.internals().botIds).toHaveLength(3);
    expect((internals.botIdentities as Map<string, { model: string }>).size).toBe(3);
    // 昵称用模型名,同模型第二席位追加 #2
    expect([...fixture.internals().nicknames.values()]).toEqual(["model-a", "model-b", "model-a#2"]);
    // 全部座位归 bot,容量只剩观战名额(默认 20)
    expect(fixture.room.maxClients).toBe(20);
    // 无真人开局:readyBots 已推进到叫地主并按正常链路落库 round_started
    expect(fixture.internals().table.snapshot().phase).toBe("bidding");
    expect(fixture.gameActions.flatMap((record) => record.actions.map((action) => action.type))).toContain("round_started");
    // 恢复信封携带竞技场标记与模型身份(崩溃恢复据此重建席位大脑)
    const lastState = fixture.gameActions.at(-1)?.state as { arena?: boolean; botModels?: Record<string, unknown> } | undefined;
    expect(lastState?.arena).toBe(true);
    expect(Object.keys(lastState?.botModels ?? {})).toHaveLength(3);
    // 阵容即赛事配置,禁用牌桌内热更
    expect(internals.botSettingsUpdatesEnabled).toBe(false);

    await fixture.room.onDispose();
  });

  it("非法阵容与缺失阵容都拒绝建房(不回退默认)", async () => {
    const bad = createRoomFixture("100042", stateResponse("100042", "open", null), {
      arena: true,
      lineup: [
        { provider: "anthropic", model: "model-a" },
        { provider: "anthropic", model: "not-allowed" },
        { provider: "anthropic", model: "model-b" }
      ],
      botRegistry: registry
    });
    await expect(bad.room.onCreate(bad.options)).rejects.toThrow(/不在服务端允许的模型列表/);

    const missing = createRoomFixture("100043", stateResponse("100043", "open", null), {
      arena: true,
      botRegistry: registry
    });
    await expect(missing.room.onCreate(missing.options)).rejects.toThrow(/必须提供 lineup/);
  });

  it("观战 join 不能凭空拉起房间(无可恢复牌局即拒绝)", async () => {
    const code = "100044";
    const fixture = createRoomFixture(code, stateResponse(code, "open", null), { spectate: true });

    await expect(fixture.room.onCreate(fixture.options)).rejects.toThrow(/不在直播中/);
  });

  it("局间推进:settled 后自动重置并把三个 bot 直接推进到下一局", async () => {
    const { room, table, recordMutation, invoke } = bareArenaRoom(settledArenaTable("100045"), "100045");

    await invoke("startNextArenaRound");

    expect(table.snapshot().phase).toBe("bidding");
    expect(
      recordMutation.mock.calls.flatMap((call) => (call[0] as { actions: Array<{ type: string }> }).actions.map((a) => a.type))
    ).toContain("round_started");
    expect(room).toBeInstanceOf(DdzRoom);
  });

  it("打满 ARENA_MAX_ROUNDS 后收官:closed 落库并断开房间", async () => {
    const fixture = bareArenaRoom(settledArenaTable("100046"), "100046");
    fixture.internals.arenaRoundsPlayed = 11; // 默认 12 局,本局是最后一局

    fixture.invoke("scheduleArenaRoundTransition");

    expect(fixture.internals.arenaRoundsPlayed).toBe(12);
    expect(fixture.clock.setTimeout).toHaveBeenCalledTimes(1);
    // 触发局间定时回调 → 收官
    (fixture.clock.setTimeout.mock.calls[0]![0] as () => void)();
    await vi.waitFor(() => {
      expect(fixture.closeRoom).toHaveBeenCalledTimes(1);
    });
    expect(fixture.disconnect).toHaveBeenCalled();
  });
});

/** 三个 bot 打完一整局的 settled 牌桌(domain 不关心是否有真人)。 */
function settledArenaTable(code: string): GameTable {
  const table = new GameTable();
  const bots = [1, 2, 3].map((index) => `bot:${code}:${index}`);
  for (const bot of bots) {
    table.addBot(bot);
  }
  for (const bot of bots) {
    table.setReady(bot);
  }
  const bidder = table.snapshot().currentPlayerId!;
  table.bidLandlord(bidder, true);
  for (let i = 0; i < 2; i += 1) {
    table.robLandlord(table.snapshot().currentPlayerId!, false);
  }
  while (table.snapshot().phase === "playing") {
    const snapshot = table.snapshot();
    const current = snapshot.currentPlayerId!;
    if (current === snapshot.landlordId) {
      table.playCards(current, [table.getHand(current)[0]!.id]);
    } else {
      table.pass(current);
    }
  }
  return table;
}

interface BareArenaRoom {
  readonly room: DdzRoom;
  readonly table: GameTable;
  readonly internals: Record<string, unknown>;
  readonly recordMutation: ReturnType<typeof vi.fn>;
  readonly closeRoom: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly clock: { setTimeout: ReturnType<typeof vi.fn> };
  readonly invoke: (method: string, ...args: unknown[]) => Promise<void>;
}

/** 裸实例 + 最小桩:只测竞技场局间推进/收官,不拉起 onCreate。 */
function bareArenaRoom(table: GameTable, code: string): BareArenaRoom {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const recordMutation = vi.fn(async () => {});
  const closeRoom = vi.fn(async () => {});
  const disconnect = vi.fn(async () => {});
  const clock = { setTimeout: vi.fn(() => ({ clear: vi.fn() })), setInterval: vi.fn(() => ({ clear: vi.fn() })) };

  Object.defineProperty(room, "clock", { value: clock, configurable: true });
  internals.roomCode = code;
  internals.table = table;
  internals.tasks = new SerialTaskQueue();
  internals.arena = true;
  internals.botIds = [1, 2, 3].map((index) => `bot:${code}:${index}`);
  internals.nicknames = new Map();
  internals.broadcast = vi.fn();
  internals.disconnect = disconnect;
  internals.persistence = { recordMutation, closeRoom };
  internals.turnScheduler = { scheduleTurnTimer: vi.fn(), scheduleBotTurn: vi.fn(), cancelAll: vi.fn() };

  return {
    room,
    table,
    internals,
    recordMutation,
    closeRoom,
    disconnect,
    clock,
    invoke: (method, ...args) =>
      Promise.resolve((room as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!(...args)) as Promise<void>
  };
}
