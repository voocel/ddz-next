import { describe, expect, it } from "vitest";

import { DEFAULT_BOT_PREFERENCES, parseBotPreferences } from "./botPreferences";

describe("parseBotPreferences（AI 机器人偏好解析）", () => {
  it("空值返回默认（服务端默认 = 空 provider/model）", () => {
    expect(parseBotPreferences(null)).toEqual(DEFAULT_BOT_PREFERENCES);
    expect(parseBotPreferences("")).toEqual(DEFAULT_BOT_PREFERENCES);
  });

  it("完整 provider+model 原样解析（思考强度缺省回退 auto）", () => {
    expect(parseBotPreferences(JSON.stringify({ provider: "deepseek", model: "deepseek-v4-pro" }))).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      reasoningEffort: "auto"
    });
  });

  it("合法思考强度原样解析，非法档位回退 auto", () => {
    expect(
      parseBotPreferences(JSON.stringify({ provider: "anthropic", model: "claude-haiku-4-5", reasoningEffort: "off" }))
    ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5", reasoningEffort: "off" });
    expect(
      parseBotPreferences(JSON.stringify({ provider: "anthropic", model: "claude-haiku-4-5", reasoningEffort: "turbo" }))
        .reasoningEffort
    ).toBe("auto");
  });

  it("缺字段/类型错误回退默认", () => {
    expect(parseBotPreferences(JSON.stringify({ provider: "deepseek" }))).toEqual(DEFAULT_BOT_PREFERENCES);
    expect(parseBotPreferences(JSON.stringify({ provider: 1, model: 2 }))).toEqual(DEFAULT_BOT_PREFERENCES);
  });

  it("损坏 JSON 安全回退默认", () => {
    expect(parseBotPreferences("{not json")).toEqual(DEFAULT_BOT_PREFERENCES);
  });
});
