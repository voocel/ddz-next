import { afterEach, describe, expect, it } from "vitest";
import { parseBotProviderRegistry } from "@ddz/bot-ai";
import { GameTable } from "@ddz/domain";
import type { RoomLiveStateEnvelope } from "@ddz/protocol";
import {
  createRoomFixture,
  restoreEnv,
  runtimeEnv,
  setEnv,
  stateResponse,
  type InternalRoomLiveState
} from "./roomCreateFixture";

const originalAiBattleEnabled = runtimeEnv().AI_BATTLE_ENABLED;
const originalAiBattleMaxActive = runtimeEnv().AI_BATTLE_MAX_ACTIVE;
const originalBotDecision = runtimeEnv().BOT_DECISION;

const llmRegistry = parseBotProviderRegistry(
  JSON.stringify({
    provider: "anthropic",
    model: "claude-haiku-4-5",
    providers: {
      anthropic: { type: "anthropic", api_key: "test-key", models: ["claude-haiku-4-5"] }
    }
  })
);

describe("DdzRoom crash recovery", () => {
  afterEach(() => {
    restoreEnv("AI_BATTLE_ENABLED", originalAiBattleEnabled);
    restoreEnv("AI_BATTLE_MAX_ACTIVE", originalAiBattleMaxActive);
    restoreEnv("BOT_DECISION", originalBotDecision);
  });

  it("restores a playing room and resumes scheduling", async () => {
    const code = "100011";
    const table = playingTable(code);
    const fixture = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));

    await fixture.room.onCreate(fixture.options);

    const snapshot = fixture.internals().table.snapshot();
    expect(snapshot.phase).toBe("playing");
    expect(snapshot.landlordId).toBe("human-1");
    // bot 名单从状态重建，真人座位等待重连;容量 = 剩余座位(1) + 观战名额(默认 20)
    expect(fixture.internals().botIds).toEqual([`bot:${code}:1`, `bot:${code}:2`]);
    expect(fixture.room.maxClients).toBe(21);
    expect(fixture.internals().nicknames.get("human-1")).toBe("Alice");
    expect(snapshot.players.find((player) => player.id === "human-1")?.connected).toBe(false);
    // 回合计时已重新调度（turn_timer 广播 + 计时器挂上）
    expect(fixture.broadcast).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "turn_timer", playerId: "human-1" })
    );

    await fixture.room.onDispose();
  });

  it("restores a settled room and waits for a human ready command before the next round", async () => {
    const code = "100012";
    const table = playingTable(code);
    sweepToSettlement(table);
    const fixture = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));

    await fixture.room.onCreate(fixture.options);

    expect(fixture.internals().table.snapshot().phase).toBe("settled");
    // 结算态不再自动重开下一局,必须等真人点击准备。
    expect(fixture.clock.setTimeout).not.toHaveBeenCalled();

    await fixture.room.onDispose();
  });

  it("restores an inter-round room, releases offline human seats and re-readies bots", async () => {
    const code = "100013";
    const table = playingTable(code);
    sweepToSettlement(table);
    table.resetForNextRound();
    const fixture = createRoomFixture(code, stateResponse(code, "open", envelope(table)));

    await fixture.room.onCreate(fixture.options);
    await fixture.flushTasks();

    const players = fixture.internals().table.snapshot().players;
    expect(players.filter((player) => player.kind === "bot").every((player) => player.ready)).toBe(true);
    // 局间相位的离线真人直接让座（永远等不到其 ready），重连走正常入房路径
    expect(players.find((player) => player.id === "human-1")).toBeUndefined();
    expect(fixture.internals().nicknames.has("human-1")).toBe(false);
    // bot 补 ready 走正常持久化路径
    expect(
      fixture.gameActions.flatMap((record) => record.actions.map((action) => action.type)).filter((type) => type === "player_ready")
    ).toHaveLength(2);

    await fixture.room.onDispose();
  });

  it("rejects closed rooms and rooms stuck in playing without recoverable state", async () => {
    const closed = createRoomFixture("100014", stateResponse("100014", "closed", null));
    await expect(closed.room.onCreate(closed.options)).rejects.toThrow("closed");

    const orphan = createRoomFixture("100015", stateResponse("100015", "playing", null));
    await expect(orphan.room.onCreate(orphan.options)).rejects.toThrow("no recoverable state");
  });

  it("rejects concurrent creation for the same room code until the live room disposes", async () => {
    const code = "100016";
    const first = createRoomFixture(code, stateResponse(code, "open", null));
    await first.room.onCreate(first.options);

    // 并发逃逸兜底：同码第二实例直接失败
    const second = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(second.room.onCreate(second.options)).rejects.toThrow("already live");

    // 首实例销毁后注册释放，同码可重新创建（即恢复场景）
    await first.room.onDispose();
    const third = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(third.room.onCreate(third.options)).resolves.toBeUndefined();
    await third.room.onDispose();
  });

  it("releases the registration when onCreate fails", async () => {
    const code = "100017";
    const failed = createRoomFixture(code, stateResponse(code, "closed", null));
    await expect(failed.room.onCreate(failed.options)).rejects.toThrow("closed");

    // onCreate 失败需立即自清注册，否则房间码被永久占用
    const retry = createRoomFixture(code, stateResponse(code, "open", null));
    await expect(retry.room.onCreate(retry.options)).resolves.toBeUndefined();
    await retry.room.onDispose();
  });

  it("rejects LLM rooms unless AI battle creation is explicitly enabled", async () => {
    const code = "100022";
    setEnv("AI_BATTLE_ENABLED", "false");
    const fixture = createRoomFixture(code, stateResponse(code, "open", null), {
      botDecisionMode: "llm",
      botRegistry: llmRegistry
    });

    await expect(fixture.room.onCreate(fixture.options)).rejects.toThrow("AI 对战当前未开启");
  });

  it("limits active LLM rooms and releases the slot on dispose", async () => {
    setEnv("AI_BATTLE_ENABLED", "true");
    setEnv("AI_BATTLE_MAX_ACTIVE", "1");

    const first = createRoomFixture("100023", stateResponse("100023", "open", null), {
      botDecisionMode: "llm",
      botRegistry: llmRegistry
    });
    await first.room.onCreate(first.options);

    const second = createRoomFixture("100024", stateResponse("100024", "open", null), {
      botDecisionMode: "llm",
      botRegistry: llmRegistry
    });
    await expect(second.room.onCreate(second.options)).rejects.toThrow("AI 对战房间已达上限");

    await first.room.onDispose();
    const third = createRoomFixture("100025", stateResponse("100025", "open", null), {
      botDecisionMode: "llm",
      botRegistry: llmRegistry
    });
    await expect(third.room.onCreate(third.options)).resolves.toBeUndefined();
    await third.room.onDispose();
  });

  it("treats BOT_DECISION=llm rooms as AI rooms that occupy a battle slot", async () => {
    setEnv("AI_BATTLE_ENABLED", "true");
    setEnv("AI_BATTLE_MAX_ACTIVE", "1");
    setEnv("BOT_DECISION", "llm");

    const code = "100026";
    const fixture = createRoomFixture(code, stateResponse(code, "open", null), { botRegistry: llmRegistry });
    await fixture.room.onCreate(fixture.options);

    const second = createRoomFixture("100027", stateResponse("100027", "open", null), { botRegistry: llmRegistry });
    await expect(second.room.onCreate(second.options)).rejects.toThrow("AI 对战房间已达上限");

    await fixture.room.onDispose();
  });

  it("never touches the DB when a failed-create zombie gets auto-disposed", async () => {
    const code = "100018";
    const zombie = createRoomFixture(code, stateResponse(code, "playing", null));
    await expect(zombie.room.onCreate(zombie.options)).rejects.toThrow("no recoverable state");

    // Colyseus 对 onCreate 失败的实例约 15s 后仍会触发 onDispose（autoDispose），
    // 此时绝不能 PATCH closed——那会删掉别人（或可恢复牌局）的状态行
    await zombie.room.onDispose();
    expect(zombie.statusUpdates).toEqual([]);
  });

  it("keeps the registration until closeRoom completes on dispose", async () => {
    const code = "100019";
    const table = playingTable(code);
    const first = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await first.room.onCreate(first.options);

    // 卡住 closed 上报：dispose 期间同码建房必须仍被注册表拒绝，
    // 否则新实例会在状态行删除前恢复，旧实例随后的 PATCH closed 把它的状态行也删掉
    let releaseClose: () => void = () => {};
    first.gateNextStatusUpdate(new Promise<void>((resolve) => (releaseClose = resolve)));
    const disposing = first.room.onDispose();

    const second = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await expect(second.room.onCreate(second.options)).rejects.toThrow("already live");

    releaseClose();
    await disposing;
    expect(first.statusUpdates).toHaveLength(1);
    expect(first.statusUpdates[0]).toMatch(/^closed:\d+:colyseus-\d+$/);

    const third = createRoomFixture(code, stateResponse(code, "playing", envelope(table)));
    await expect(third.room.onCreate(third.options)).resolves.toBeUndefined();
    await third.room.onDispose();
  });

});

/** 真人地主 + 双 bot 的确定性 playing 局面 */
function playingTable(code: string): GameTable {
  const table = new GameTable();
  table.addPlayer("human-1");
  table.addBot(`bot:${code}:1`);
  table.addBot(`bot:${code}:2`);
  table.setReady(`bot:${code}:1`);
  table.setReady(`bot:${code}:2`);
  table.setReady("human-1");
  table.bidLandlord("human-1", true);
  table.robLandlord(`bot:${code}:1`, false);
  table.robLandlord(`bot:${code}:2`, false);
  return table;
}

function sweepToSettlement(table: GameTable): void {
  while (table.snapshot().phase === "playing") {
    const snapshot = table.snapshot();
    const current = snapshot.currentPlayerId!;
    if (current === snapshot.landlordId) {
      table.playCards(current, [table.getHand(current)[0]!.id]);
    } else {
      table.pass(current);
    }
  }
}

function envelope(table: GameTable): InternalRoomLiveState {
  const state: RoomLiveStateEnvelope = {
    version: 1,
    table: table.dump(),
    nicknames: { "human-1": "Alice" }
  };
  return state as unknown as InternalRoomLiveState;
}
