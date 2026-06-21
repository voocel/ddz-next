import { describe, expect, it } from "vitest";
import { isAllowedModel, listModels, parseBotProviderRegistry } from "../src";

const SAMPLE = JSON.stringify({
  provider: "deepseek",
  model: "deepseek-v4-pro",
  providers: {
    deepseek: {
      type: "deepseek",
      api_key: "sk-xxx",
      base_url: "https://api.deepseek.com",
      models: ["deepseek-v4-pro", "deepseek-v4-flash"]
    },
    anthropic: {
      type: "anthropic",
      api_key: "sk-ant-xxx",
      models: ["claude-haiku-4-5"],
      label: "Anthropic"
    },
    openrouter: {
      // 缺 type:按 openai-compatible 处理
      api_key: "sk-or-xxx",
      base_url: "https://openrouter.ai/api/v1",
      models: ["qwen/qwen3.6-plus"]
    },
    mimo: {
      type: "mimo",
      api_key: "tp-xxx",
      base_url: "https://token-plan-cn.xiaomimimo.com/v1",
      models: ["mimo-v2.5-pro"],
      label: "MiMo"
    }
  }
});

describe("parseBotProviderRegistry（多 provider 注册表解析）", () => {
  it("按 snake_case 解析并归一化 type/key/baseURL", () => {
    const registry = parseBotProviderRegistry(SAMPLE);
    expect(registry.default).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(registry.providers.deepseek).toMatchObject({
      type: "deepseek",
      apiKey: "sk-xxx",
      baseURL: "https://api.deepseek.com"
    });
    // type:deepseek / mimo 使用各自官方兼容接口;anthropic 原样保留;缺 type 的 openrouter 归一化为 openai-compatible
    expect(registry.providers.anthropic?.type).toBe("anthropic");
    expect(registry.providers.mimo?.type).toBe("mimo");
    expect(registry.providers.openrouter?.type).toBe("openai-compatible");
  });

  it("default 指向非法模型时回退首个可用模型", () => {
    const raw = JSON.stringify({
      provider: "ghost",
      model: "not-real",
      providers: {
        deepseek: { type: "deepseek", api_key: "k", base_url: "https://api.deepseek.com", models: ["deepseek-v4-pro"] }
      }
    });
    expect(parseBotProviderRegistry(raw).default).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
  });

  it("raw 为空时用 ANTHROPIC_API_KEY 合成单 anthropic 供应商(向后兼容)", () => {
    const registry = parseBotProviderRegistry(null, { ANTHROPIC_API_KEY: "sk-ant", BOT_DECISION_MODEL: "claude-opus-4-8" });
    expect(registry.default).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
    expect(registry.providers.anthropic?.apiKey).toBe("sk-ant");
  });

  it("空配置且 BOT_DECISION_MODEL 非白名单时回退 haiku", () => {
    const registry = parseBotProviderRegistry("", { BOT_DECISION_MODEL: "gpt-4o" });
    expect(registry.default.model).toBe("claude-haiku-4-5");
  });

  it("JSON 非法/schema 不符直接抛错", () => {
    expect(() => parseBotProviderRegistry("{not json")).toThrow();
    expect(() => parseBotProviderRegistry(JSON.stringify({ provider: "x" }))).toThrow();
  });

  it("已知官方 provider 写成通用 openai-compatible 时直接暴露配置错误", () => {
    expect(() =>
      parseBotProviderRegistry(
        JSON.stringify({
          provider: "mimo",
          model: "mimo-v2.5",
          providers: {
            mimo: {
              type: "openai-compatible",
              api_key: "tp-xxx",
              base_url: "https://token-plan-cn.xiaomimimo.com/v1",
              models: ["mimo-v2.5"]
            }
          }
        })
      )
    ).toThrow('Set type to "mimo"');

    expect(() =>
      parseBotProviderRegistry(
        JSON.stringify({
          provider: "deepseek",
          model: "deepseek-v4-pro",
          providers: {
            deepseek: {
              api_key: "sk-xxx",
              base_url: "https://api.deepseek.com",
              models: ["deepseek-v4-pro"]
            }
          }
        })
      )
    ).toThrow('Set type to "deepseek"');

    expect(() =>
      parseBotProviderRegistry(
        JSON.stringify({
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          providers: {
            anthropic: {
              type: "openai",
              api_key: "sk-xxx",
              base_url: "https://api.anthropic.com/v1",
              models: ["claude-sonnet-4-6"]
            }
          }
        })
      )
    ).toThrow('Set type to "anthropic"');
  });

  it("不靠 claude 模型名推断协议,聚合网关可显式配置为 openai-compatible", () => {
    const registry = parseBotProviderRegistry(
      JSON.stringify({
        provider: "jun",
        model: "claude-sonnet-4-6",
        providers: {
          jun: {
            type: "openai-compatible",
            api_key: "sk-xxx",
            base_url: "https://example.com/v1",
            models: ["claude-sonnet-4-6"]
          }
        }
      })
    );

    expect(registry.providers.jun?.type).toBe("openai-compatible");
  });
});

describe("listModels / isAllowedModel", () => {
  const registry = parseBotProviderRegistry(SAMPLE);

  it("listModels 扁平列出全部模型且不含密钥", () => {
    const options = listModels(registry);
    expect(options).toContainEqual({ provider: "deepseek", model: "deepseek-v4-flash", providerLabel: "deepseek" });
    expect(options).toContainEqual({ provider: "anthropic", model: "claude-haiku-4-5", providerLabel: "Anthropic" });
    expect(options).toContainEqual({ provider: "mimo", model: "mimo-v2.5-pro", providerLabel: "MiMo" });
    expect(JSON.stringify(options)).not.toContain("sk-");
  });

  it("isAllowedModel 校验 provider+model 是否在注册表内", () => {
    expect(isAllowedModel(registry, { provider: "deepseek", model: "deepseek-v4-pro" })).toBe(true);
    expect(isAllowedModel(registry, { provider: "deepseek", model: "nope" })).toBe(false);
    expect(isAllowedModel(registry, { provider: "ghost", model: "x" })).toBe(false);
  });
});
