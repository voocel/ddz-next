import { describe, expect, it } from "vitest";
import { parseLineupDefaults } from "./lineupDefaults";

const challenge = {
  models: [
    { provider: "anthropic", model: "model-a" },
    { provider: "deepseek", model: "model-b" }
  ],
  reasoningEffort: "high"
};

describe("parseLineupDefaults", () => {
  it("空/损坏输入安全回退为空", () => {
    expect(parseLineupDefaults(null)).toEqual({});
    expect(parseLineupDefaults("")).toEqual({});
    expect(parseLineupDefaults("not-json")).toEqual({});
    expect(parseLineupDefaults(JSON.stringify("nope"))).toEqual({});
  });

  it("按 kind 解析,challenge 恰好 2 席/arena 恰好 3 席", () => {
    const parsed = parseLineupDefaults(JSON.stringify({ challenge }));
    expect(parsed.challenge?.models).toHaveLength(2);
    expect(parsed.challenge?.reasoningEffort).toBe("high");
    expect(parsed.arena).toBeUndefined();
  });

  it("席数不符或席位形状损坏时丢弃该 kind", () => {
    expect(parseLineupDefaults(JSON.stringify({ challenge: { ...challenge, models: challenge.models.slice(0, 1) } }))).toEqual({});
    expect(
      parseLineupDefaults(JSON.stringify({ challenge: { ...challenge, models: [challenge.models[0], { provider: 1 }] } }))
    ).toEqual({});
  });

  it("非法思考强度回退默认 medium", () => {
    const parsed = parseLineupDefaults(JSON.stringify({ challenge: { ...challenge, reasoningEffort: "turbo" } }));
    expect(parsed.challenge?.reasoningEffort).toBe("medium");
  });
});
