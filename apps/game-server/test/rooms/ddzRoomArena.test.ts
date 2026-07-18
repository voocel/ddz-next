import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBotProviderRegistry } from "@ddz/bot-ai";
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
    // 竞技场协作者接线完成:生命周期导演与 bot 回合控制器都已装配
    expect(internals.arenaDirector).toBeDefined();
    expect(internals.botController).toBeDefined();

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

  // 局间推进/收官/流局的行为细节已随 ArenaDirector 抽取迁至 arenaDirector.test.ts(隔离测试)
});
