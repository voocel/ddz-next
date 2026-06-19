import { describe, expect, it } from "vitest";
import { reduceThinking, EMPTY_THINKING } from "./botThinking";

/** 造一个 bot_ai_stream 事件(测试夹具)。 */
function ev(
  playerId: string,
  channel: "reasoning" | "text",
  text: string,
  done: boolean,
  choice?: { readonly index: number; readonly label: string }
) {
  return choice
    ? ({ type: "bot_ai_stream", playerId, channel, text, done, choice } as const)
    : ({ type: "bot_ai_stream", playerId, channel, text, done } as const);
}

describe("reduceThinking", () => {
  it("首个增量为该 bot 新建条目(active)", () => {
    const state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "对手剩两张,", false));
    expect(state.bot1).toEqual({ channels: { reasoning: "对手剩两张,", text: "" }, active: true });
  });

  it("active 期间按 channel 持续追加,互不覆盖", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "对手剩两张,", false));
    state = reduceThinking(state, ev("bot1", "text", "1", false));
    state = reduceThinking(state, ev("bot1", "reasoning", "我先压一手", false));
    expect(state.bot1).toEqual({ channels: { reasoning: "对手剩两张,我先压一手", text: "1" }, active: true });
  });

  it("done 追加剩余片段并冻结(active=false),文本保留", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "前段", false));
    state = reduceThinking(state, ev("bot1", "reasoning", "收尾", true));
    expect(state.bot1).toEqual({ channels: { reasoning: "前段收尾", text: "" }, active: false });
  });

  it("同一手多个 channel 分别 done 时保留已冻结文本", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "推理", false));
    state = reduceThinking(state, ev("bot1", "text", "1", false));
    state = reduceThinking(state, ev("bot1", "reasoning", "", true));
    state = reduceThinking(state, ev("bot1", "text", "", true));
    expect(state.bot1).toEqual({ channels: { reasoning: "推理", text: "1" }, active: false });
  });

  it("done 后再来增量视为新一轮,清空旧文本重新累积", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "上一手思考", false));
    state = reduceThinking(state, ev("bot1", "reasoning", "", true));
    expect(state.bot1).toEqual({ channels: { reasoning: "上一手思考", text: "" }, active: false });
    state = reduceThinking(state, ev("bot1", "text", "新一轮", false));
    expect(state.bot1).toEqual({ channels: { reasoning: "", text: "新一轮" }, active: true });
  });

  it("多个 bot 各自独立累积,互不干扰", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "reasoning", "甲想", false));
    state = reduceThinking(state, ev("bot2", "text", "乙答", false));
    state = reduceThinking(state, ev("bot1", "reasoning", "甲续", false));
    expect(state.bot1).toEqual({ channels: { reasoning: "甲想甲续", text: "" }, active: true });
    expect(state.bot2).toEqual({ channels: { reasoning: "", text: "乙答" }, active: true });
  });

  it("done 事件可携带模型编号对应的具体候选动作", () => {
    const state = reduceThinking(EMPTY_THINKING, ev("bot1", "text", "", true, { index: 1, label: "单张4" }));

    expect(state.bot1).toEqual({
      channels: { reasoning: "", text: "" },
      choice: { index: 1, label: "单张4" },
      active: false
    });
  });

  it("done 后新一轮增量清空上一手 choice", () => {
    let state = reduceThinking(EMPTY_THINKING, ev("bot1", "text", "", true, { index: 1, label: "单张4" }));
    state = reduceThinking(state, ev("bot1", "reasoning", "新一手", false));

    expect(state.bot1).toEqual({ channels: { reasoning: "新一手", text: "" }, active: true });
  });
});
