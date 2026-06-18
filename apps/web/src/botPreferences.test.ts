import { describe, expect, it } from "vitest";

import { DEFAULT_BOT_PREFERENCES, parseBotPreferences } from "./botPreferences";

describe("parseBotPreferences（AI 机器人偏好解析）", () => {
  it("空值返回默认（服务端默认 = 空 provider/model）", () => {
    expect(parseBotPreferences(null)).toEqual(DEFAULT_BOT_PREFERENCES);
    expect(parseBotPreferences("")).toEqual(DEFAULT_BOT_PREFERENCES);
  });

  it("完整 provider+model 原样解析", () => {
    expect(parseBotPreferences(JSON.stringify({ provider: "deepseek", model: "deepseek-v4-pro" }))).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro"
    });
  });

  it("缺字段/类型错误回退默认", () => {
    expect(parseBotPreferences(JSON.stringify({ provider: "deepseek" }))).toEqual(DEFAULT_BOT_PREFERENCES);
    expect(parseBotPreferences(JSON.stringify({ provider: 1, model: 2 }))).toEqual(DEFAULT_BOT_PREFERENCES);
  });

  it("损坏 JSON 安全回退默认", () => {
    expect(parseBotPreferences("{not json")).toEqual(DEFAULT_BOT_PREFERENCES);
  });
});
