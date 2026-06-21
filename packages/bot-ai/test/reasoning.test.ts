import { describe, expect, it } from "vitest";
import { buildReasoningProviderOptions, parseReasoningEffort } from "../src";

describe("parseReasoningEffort", () => {
  it("合法档位原样返回", () => {
    for (const effort of ["auto", "off", "low", "medium", "high"] as const) {
      expect(parseReasoningEffort(effort)).toBe(effort);
    }
  });

  it("非法 / 缺省 / 非字符串一律回退 auto", () => {
    expect(parseReasoningEffort("turbo")).toBe("auto");
    expect(parseReasoningEffort(undefined)).toBe("auto");
    expect(parseReasoningEffort(null)).toBe("auto");
    expect(parseReasoningEffort(3)).toBe("auto");
  });
});

describe("buildReasoningProviderOptions", () => {
  it("auto 完全不干预(返回 undefined)", () => {
    expect(buildReasoningProviderOptions("anthropic", "anthropic", "auto")).toBeUndefined();
    expect(buildReasoningProviderOptions("deepseek", "deepseek", "auto")).toBeUndefined();
    expect(buildReasoningProviderOptions("mimo", "mimo", "auto")).toBeUndefined();
    expect(buildReasoningProviderOptions("openai-compatible", "openai", "auto")).toBeUndefined();
  });

  it("anthropic:关闭走 thinking.disabled,强度走 effort(不碰 budgetTokens)", () => {
    expect(buildReasoningProviderOptions("anthropic", "anthropic", "off")).toEqual({
      anthropic: { thinking: { type: "disabled" } }
    });
    expect(buildReasoningProviderOptions("anthropic", "anthropic", "low")).toEqual({ anthropic: { effort: "low" } });
    expect(buildReasoningProviderOptions("anthropic", "anthropic", "medium")).toEqual({
      anthropic: { effort: "medium" }
    });
    expect(buildReasoningProviderOptions("anthropic", "anthropic", "high")).toEqual({ anthropic: { effort: "high" } });
  });

  it("deepseek:关闭走 thinking.disabled,强度走官方 reasoning_effort,键固定为 deepseek", () => {
    expect(buildReasoningProviderOptions("deepseek", "deepseek", "off")).toEqual({
      deepseek: { thinking: { type: "disabled" } }
    });
    expect(buildReasoningProviderOptions("deepseek", "deepseek", "high")).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoning_effort: "high" }
    });
    // 即使注册表里把它命名成别的(ds-alias),providerOptions 键仍是适配器固定的 "deepseek"
    expect(buildReasoningProviderOptions("deepseek", "ds-alias", "medium")).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoning_effort: "high" }
    });
  });

  it("mimo:官方只支持 thinking 开关,off 关闭,其它强度开启", () => {
    expect(buildReasoningProviderOptions("mimo", "mimo", "off")).toEqual({
      mimo: { thinking: { type: "disabled" } }
    });
    expect(buildReasoningProviderOptions("mimo", "mimo", "low")).toEqual({
      mimo: { thinking: { type: "enabled" } }
    });
    expect(buildReasoningProviderOptions("mimo", "mimo", "medium")).toEqual({
      mimo: { thinking: { type: "enabled" } }
    });
    expect(buildReasoningProviderOptions("mimo", "mimo", "high")).toEqual({
      mimo: { thinking: { type: "enabled" } }
    });
  });

  it("openai-compatible(OpenAI/本地等):reasoningEffort 键为 provider 名;off 退化为最低档 low", () => {
    expect(buildReasoningProviderOptions("openai-compatible", "openai", "medium")).toEqual({
      openai: { reasoningEffort: "medium" }
    });
    expect(buildReasoningProviderOptions("openai-compatible", "openai", "high")).toEqual({
      openai: { reasoningEffort: "high" }
    });
    expect(buildReasoningProviderOptions("openai-compatible", "openai", "off")).toEqual({
      openai: { reasoningEffort: "low" }
    });
  });
});
