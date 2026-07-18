import { describe, expect, it, vi } from "vitest";
import type { GameEvent } from "@ddz/protocol";
import { BotStreamBroadcaster } from "../../src/rooms/botStreamBroadcaster.js";

type StreamEvent = Extract<GameEvent, { type: "bot_ai_stream" }>;

function createBroadcaster(overrides: { failed?: () => boolean } = {}) {
  const events: StreamEvent[] = [];
  const broadcaster = new BotStreamBroadcaster({
    broadcast: (event) => {
      events.push(event as StreamEvent);
    },
    isFailed: overrides.failed ?? (() => false)
  });
  return { broadcaster, events };
}

describe("BotStreamBroadcaster", () => {
  it("start 立即广播空 text 事件作为「开始思考」信号", () => {
    const { broadcaster, events } = createBroadcaster();
    broadcaster.start("bot-1");
    expect(events).toEqual([{ type: "bot_ai_stream", playerId: "bot-1", channel: "text", text: "", done: false }]);
  });

  it("首个可见片段不节流立即广播,后续增量按阈值(16 字)节流", () => {
    const { broadcaster, events } = createBroadcaster();
    broadcaster.start("bot-1");
    // 首个非空片段:即使远小于阈值也立即冲刷
    broadcaster.append("bot-1", "reasoning", "嗯");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ channel: "reasoning", text: "嗯", done: false });
    // 已冲刷过:小增量进入缓冲不广播
    broadcaster.append("bot-1", "reasoning", "先看牌");
    expect(events).toHaveLength(2);
    // 累积到阈值以上才广播
    broadcaster.append("bot-1", "reasoning", "力,对手剩两张,必须顶住这一手压制");
    expect(events).toHaveLength(3);
    expect(events[2]!.done).toBe(false);
    expect(events[2]!.text.length).toBeGreaterThanOrEqual(16);
  });

  it("end 冲刷各通道剩余片段并带 done:true 与最终选择", () => {
    const { broadcaster, events } = createBroadcaster();
    broadcaster.start("bot-1");
    broadcaster.append("bot-1", "reasoning", "先手甩对");
    broadcaster.setChoice("bot-1", { index: 2, label: "对7" });
    broadcaster.end("bot-1");
    const done = events.filter((event) => event.done);
    // start 留下的 text 通道 + reasoning 通道各收尾一条,choice 附带其上
    expect(done).toHaveLength(2);
    expect(done.every((event) => event.choice?.label === "对7")).toBe(true);
  });

  it("本手没产生过输出(无键)时 end 什么都不发", () => {
    const { broadcaster, events } = createBroadcaster();
    broadcaster.end("bot-1");
    expect(events).toHaveLength(0);
  });

  it("房间失败后不再广播,但 end 仍清缓冲(同一 playerId 再次 end 无键可发)", () => {
    let failed = false;
    const { broadcaster, events } = createBroadcaster({ failed: () => failed });
    broadcaster.start("bot-1");
    broadcaster.append("bot-1", "reasoning", "思考中");
    failed = true;
    broadcaster.append("bot-1", "reasoning", "更多思考");
    broadcaster.end("bot-1");
    expect(events.filter((event) => event.done)).toHaveLength(0);
    // 缓冲已清:恢复后 end 也不会再发陈旧内容
    failed = false;
    broadcaster.end("bot-1");
    expect(events.filter((event) => event.done)).toHaveLength(0);
  });
});
