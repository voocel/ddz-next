import { describe, expect, it, vi } from "vitest";
import { GameTable } from "@ddz/domain";
import { toSnapshotDto } from "../../src/dto";
import { ArenaCommentaryDirector } from "../../src/rooms/arenaCommentary";
import { ArenaDirector } from "../../src/rooms/arenaDirector";

/** 三个 bot 推进到出牌阶段的牌桌(domain 不关心是否有真人)。 */
function arenaTableAtPlaying(code: string): GameTable {
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
  return table;
}

/** 三个 bot 打完一整局的 settled 牌桌。 */
function settledArenaTable(code: string): GameTable {
  const table = arenaTableAtPlaying(code);
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

function createDirector(table: GameTable, overrides: { maxRounds?: number; intermissionMs?: number } = {}) {
  const clock = { setTimeout: vi.fn(() => ({ clear: vi.fn() })) };
  const recordMutation = vi.fn(async () => {});
  const broadcast = vi.fn();
  const cancelTimers = vi.fn();
  const clearBotFailure = vi.fn();
  const readyBots = vi.fn(async () => {});
  const closeRoom = vi.fn(async () => {});
  const disconnect = vi.fn();
  const onFailure = vi.fn(async () => {});
  const comment = vi.fn(async () => "解说词");

  const director = new ArenaDirector({
    roomCode: "100045",
    maxRounds: overrides.maxRounds ?? 12,
    intermissionMs: overrides.intermissionMs ?? 15_000,
    commentary: new ArenaCommentaryDirector({ commentator: { comment }, broadcast: vi.fn(), minIntervalMs: 0 }),
    table,
    clock,
    enqueue: (task) => task(),
    isFailed: () => false,
    nickname: () => undefined,
    botModel: () => undefined,
    botPlayersPayload: () => ({ "bot:100045:1": { provider: "anthropic", model: "model-a" } }),
    recordMutation,
    broadcast,
    toSnapshotDto: (snapshot) => toSnapshotDto(snapshot, new Map(), new Map()),
    cancelTimers,
    clearBotFailure,
    readyBots,
    closeRoom,
    disconnect,
    onFailure
  });

  return { director, clock, recordMutation, broadcast, cancelTimers, clearBotFailure, readyBots, closeRoom, disconnect, onFailure, comment };
}

/** 触发第 index 个已安排的局间定时回调。 */
function fireTimer(clock: { setTimeout: ReturnType<typeof vi.fn> }, index = 0): void {
  (clock.setTimeout.mock.calls[index]![0] as () => void)();
}

describe("ArenaDirector", () => {
  it("开局解说随局数推进:首局开幕文案,续局报局数", async () => {
    const fixture = createDirector(settledArenaTable("100045"));

    fixture.director.announceRoundStart();
    await vi.waitFor(() => {
      expect(fixture.comment).toHaveBeenCalledTimes(1);
    });
    expect((fixture.comment.mock.calls[0]![0] as { event: string }).event).toContain("比赛开始");
    // 等解说导演的单 in-flight 释放(finally 在宏任务边界后才跑完)
    await new Promise((resolve) => setTimeout(resolve, 0));

    fixture.director.scheduleRoundTransition();
    fixture.director.announceRoundStart();
    await vi.waitFor(() => {
      expect(fixture.comment).toHaveBeenCalledTimes(2);
    });
    expect((fixture.comment.mock.calls[1]![0] as { event: string }).event).toContain("第 2 局发牌完毕");
  });

  it("局间推进:settled 后重置牌桌并把三个 bot 推向下一局", async () => {
    const table = settledArenaTable("100045");
    const fixture = createDirector(table);

    fixture.director.scheduleRoundTransition();
    expect(fixture.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);

    fireTimer(fixture.clock);
    await vi.waitFor(() => {
      expect(fixture.readyBots).toHaveBeenCalledTimes(1);
    });
    expect(table.snapshot().phase).not.toBe("settled");
  });

  it("流局:round_aborted 落库+广播,清失败态,回 ready 并安排下一局", async () => {
    const table = arenaTableAtPlaying("100045");
    const failedBot = table.snapshot().currentPlayerId!;
    const fixture = createDirector(table);

    await fixture.director.abortRound(failedBot, "上游宕机");

    expect(fixture.clearBotFailure).toHaveBeenCalledWith(failedBot);
    expect(fixture.cancelTimers).toHaveBeenCalledTimes(1);
    expect(fixture.recordMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            type: "round_aborted",
            playerId: failedBot,
            payload: expect.objectContaining({
              reason: "上游宕机",
              failedPlayerId: failedBot,
              players: expect.arrayContaining([expect.objectContaining({ playerId: failedBot })]),
              botPlayers: { "bot:100045:1": { provider: "anthropic", model: "model-a" } }
            })
          })
        ]
      })
    );
    expect(fixture.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "round_aborted", failedPlayerId: failedBot, reason: "上游宕机" })
    );
    expect(table.snapshot().phase).toBe("ready");
    expect(fixture.onFailure).not.toHaveBeenCalled();
    // 单次流局不止损,按局间节奏安排下一局
    expect(fixture.clock.setTimeout).toHaveBeenCalledTimes(1);
  });

  it("连续第二次流局:onFailure 止损且不再安排下一局", async () => {
    const table = arenaTableAtPlaying("100045");
    const fixture = createDirector(table);

    await fixture.director.abortRound(table.snapshot().currentPlayerId!, "上游宕机");
    // 回到 ready 后重新开一局再次失败
    for (const player of table.snapshot().players) {
      table.setReady(player.id);
    }
    await fixture.director.abortRound(table.snapshot().currentPlayerId!, "上游宕机");

    expect(fixture.onFailure).toHaveBeenCalledTimes(1);
    expect(fixture.onFailure.mock.calls[0]![1]).toBe("Arena aborted repeatedly.");
    expect((fixture.onFailure.mock.calls[0]![0] as Error).message).toContain("连续 2 局流局");
    // 止损后不再安排局间推进(仅首次流局那一次)
    expect(fixture.clock.setTimeout).toHaveBeenCalledTimes(1);
  });

  it("迟到的流局任务:非对局相位直接放弃,不落库不广播", async () => {
    const fixture = createDirector(settledArenaTable("100045"));

    await fixture.director.abortRound("bot:100045:1", "上游宕机");

    expect(fixture.recordMutation).not.toHaveBeenCalled();
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });

  it("打满 maxRounds 后收官:closed 落库并断开房间", async () => {
    const fixture = createDirector(settledArenaTable("100046"), { maxRounds: 1 });

    fixture.director.scheduleRoundTransition();
    expect(fixture.clock.setTimeout).toHaveBeenCalledTimes(1);

    fireTimer(fixture.clock);
    await vi.waitFor(() => {
      expect(fixture.closeRoom).toHaveBeenCalledTimes(1);
    });
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
    expect(fixture.readyBots).not.toHaveBeenCalled();
  });
});
