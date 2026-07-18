import { describe, expect, it, vi } from "vitest";
import { DdzRoom } from "../../src/rooms/DdzRoom";
import { playingTable } from "./tableFixtures";

/**
 * 房间侧的失败/重试接线(状态机本体见 botTurnController.test.ts,流局行为见 arenaDirector.test.ts):
 * retry_bot_turn 命令的真人校验 + 转发,以及 controller 抛错经 command_rejected 回传。
 */
describe("DdzRoom bot decision failure glue", () => {
  it("retry_bot_turn:非真人玩家被拒,真人转发给 BotTurnController", async () => {
    const glue = createRoomGlue();

    await glue.handleCommand(glue.botBoundClient, { type: "retry_bot_turn" });
    expect(glue.botBoundClient.send).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "command_rejected", reason: "只有房间内真人玩家可以重新请求 AI 出牌。" })
    );
    expect(glue.retryManually).not.toHaveBeenCalled();

    await glue.handleCommand(glue.humanClient, { type: "retry_bot_turn" });
    expect(glue.retryManually).toHaveBeenCalledTimes(1);
  });

  it("controller 抛出的中文错误经 command_rejected 回传给发起客户端", async () => {
    const glue = createRoomGlue();
    glue.retryManually.mockImplementation(() => {
      throw new Error("当前没有可重试的 AI 出牌错误。");
    });

    await glue.handleCommand(glue.humanClient, { type: "retry_bot_turn" });

    expect(glue.humanClient.send).toHaveBeenCalledWith(
      "event",
      expect.objectContaining({ type: "command_rejected", reason: "当前没有可重试的 AI 出牌错误。" })
    );
  });
});

function createRoomGlue() {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const retryManually = vi.fn();
  const humanClient = { sessionId: "s-human", send: vi.fn() };
  // 防御性分支:绑定到 bot 席位的畸形会话也会被真人校验拒绝
  const botBoundClient = { sessionId: "s-bot", send: vi.fn() };

  internals.roomCode = "100031";
  internals.table = playingTable();
  internals.clientPlayers = new Map([
    [humanClient.sessionId, "human-1"],
    [botBoundClient.sessionId, "bot:100031:2"]
  ]);
  internals.botController = { retryManually };

  return {
    humanClient,
    botBoundClient,
    retryManually,
    handleCommand: (client: { sessionId: string; send: ReturnType<typeof vi.fn> }, payload: unknown) =>
      (room as unknown as { handleCommand(client: unknown, payload: unknown): Promise<void> }).handleCommand(client, payload)
  };
}
