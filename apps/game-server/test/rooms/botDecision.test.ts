import { describe, expect, it } from "vitest";
import { parseBotProviderRegistry, type BotProviderRegistry, type DecisionConfig } from "@ddz/bot-ai";
import { RuleBotBrain } from "../../src/rooms/ruleBotBrain";
import { LlmBotBrain } from "../../src/rooms/llmBotBrain";
import { resolveBotBrain, resolveBotBrainUpdate, resolveDecisionConfig } from "../../src/rooms/botDecision";

// 两 provider 注册表:default = anthropic/claude-haiku-4-5;另含 deepseek 以验证跨 provider 选择。
const registry: BotProviderRegistry = parseBotProviderRegistry(
  JSON.stringify({
    provider: "anthropic",
    model: "claude-haiku-4-5",
    providers: {
      anthropic: { type: "anthropic", api_key: "k", models: ["claude-haiku-4-5", "claude-opus-4-8"] },
      deepseek: { type: "deepseek", api_key: "k", base_url: "https://api.deepseek.com", models: ["deepseek-v4-pro"] }
    }
  })
);

const ruleEnv: DecisionConfig = { useLlm: false, timeoutMs: 8000, reasoningEffort: "auto" };
const llmEnv: DecisionConfig = { useLlm: true, timeoutMs: 8000, reasoningEffort: "auto" };

describe("resolveDecisionConfig", () => {
  it("无 options 时沿用 env 开关 + registry 默认模型", () => {
    expect(resolveDecisionConfig({}, registry, ruleEnv)).toEqual({
      useLlm: false,
      model: registry.default,
      timeoutMs: 8000,
      reasoningEffort: "auto"
    });
    expect(resolveDecisionConfig({}, registry, llmEnv).useLlm).toBe(true);
  });

  it("客户端选 llm 覆盖 env 的 rule 默认", () => {
    const config = resolveDecisionConfig({ botDecisionMode: "llm" }, registry, ruleEnv);
    expect(config.useLlm).toBe(true);
    expect(config.model).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("客户端选 rule 覆盖 env 的 llm 默认", () => {
    expect(resolveDecisionConfig({ botDecisionMode: "rule" }, registry, llmEnv).useLlm).toBe(false);
  });

  it("注册表内的 provider+model 被采纳(可跨 provider)", () => {
    const config = resolveDecisionConfig(
      { botDecisionMode: "llm", botProvider: "deepseek", botModel: "deepseek-v4-pro" },
      registry,
      ruleEnv
    );
    expect(config.model).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
  });

  it("注册表外的 provider/model 被忽略,回退 registry 默认", () => {
    expect(
      resolveDecisionConfig({ botDecisionMode: "llm", botProvider: "deepseek", botModel: "nope" }, registry, ruleEnv)
        .model
    ).toEqual(registry.default);
    expect(
      resolveDecisionConfig({ botDecisionMode: "llm", botProvider: "ghost", botModel: "x" }, registry, ruleEnv).model
    ).toEqual(registry.default);
  });

  it("只给 model 不给 provider 时忽略(回退默认)", () => {
    expect(
      resolveDecisionConfig({ botDecisionMode: "llm", botModel: "claude-opus-4-8" }, registry, ruleEnv).model
    ).toEqual(registry.default);
  });

  it("非法 mode 回退 env 默认(不被当作 llm)", () => {
    expect(resolveDecisionConfig({ botDecisionMode: "evil" }, registry, ruleEnv).useLlm).toBe(false);
    expect(resolveDecisionConfig({ botDecisionMode: "evil" }, registry, llmEnv).useLlm).toBe(true);
  });

  it("无 botReasoningEffort 时沿用 env 思考强度默认", () => {
    const env: DecisionConfig = { useLlm: true, timeoutMs: 8000, reasoningEffort: "off" };
    expect(resolveDecisionConfig({}, registry, env).reasoningEffort).toBe("off");
  });

  it("客户端思考强度覆盖 env 默认", () => {
    expect(resolveDecisionConfig({ botReasoningEffort: "high" }, registry, ruleEnv).reasoningEffort).toBe("high");
  });

  it("非法思考强度回退 auto(显式发了就不再取 env 默认)", () => {
    const env: DecisionConfig = { useLlm: true, timeoutMs: 8000, reasoningEffort: "off" };
    expect(resolveDecisionConfig({ botReasoningEffort: "turbo" }, registry, env).reasoningEffort).toBe("auto");
  });
});

describe("resolveBotBrain", () => {
  it("rule 配置造规则大脑", () => {
    expect(resolveBotBrain({}, registry, ruleEnv)).toBeInstanceOf(RuleBotBrain);
  });

  it("llm 配置造大模型大脑(构造不触网)", () => {
    expect(resolveBotBrain({ botDecisionMode: "llm" }, registry, ruleEnv)).toBeInstanceOf(LlmBotBrain);
  });

  it("选 llm 但所选模型缺 key 时直接抛错(不静默回退规则)", () => {
    // deepseek 这里没配 api_key(openai-compatible 不回退环境变量)→ resolveModel 为 null → 抛错
    const noKeyRegistry = parseBotProviderRegistry(
      JSON.stringify({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        providers: { deepseek: { type: "deepseek", base_url: "https://api.deepseek.com", models: ["deepseek-v4-pro"] } }
      })
    );
    expect(() => resolveBotBrain({ botDecisionMode: "llm" }, noKeyRegistry, ruleEnv)).toThrow(/未配置|配置|API key/);
  });

  it("缺 key 但走规则(useLlm=false)时不抛错,正常造规则大脑", () => {
    const noKeyRegistry = parseBotProviderRegistry(
      JSON.stringify({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        providers: { deepseek: { type: "deepseek", base_url: "https://api.deepseek.com", models: ["deepseek-v4-pro"] } }
      })
    );
    expect(resolveBotBrain({}, noKeyRegistry, ruleEnv)).toBeInstanceOf(RuleBotBrain);
  });
});

describe("resolveBotBrainUpdate", () => {
  it("动态更新合法模型时造大模型大脑", () => {
    expect(
      resolveBotBrainUpdate({ provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "off" }, registry)
    ).toBeInstanceOf(LlmBotBrain);
  });

  it("动态更新空 provider/model 时切回服务端默认模型", () => {
    expect(resolveBotBrainUpdate({ provider: "", model: "", reasoningEffort: "high" }, registry)).toBeInstanceOf(
      LlmBotBrain
    );
  });

  it("动态更新非法 provider/model 时显式拒绝,不静默回退默认模型", () => {
    expect(() =>
      resolveBotBrainUpdate({ provider: "deepseek", model: "missing", reasoningEffort: "off" }, registry)
    ).toThrow(/不在服务端允许的模型列表/);
  });

  it("动态更新只给 provider 或只给 model 时显式拒绝", () => {
    expect(() => resolveBotBrainUpdate({ provider: "deepseek", model: "", reasoningEffort: "off" }, registry)).toThrow(
      /必须同时为空或同时提供/
    );
  });
});
