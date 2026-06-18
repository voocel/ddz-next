import { describe, expect, it } from "vitest";
import { loadBotProviderRegistry, readBotProvidersRaw } from "../src/botProviders";

// 指向必然不存在的绝对路径,隔离掉本地可能真实存在的 bot-providers.json(避免测试受环境影响)。
const NO_FILE = "/nonexistent/ddz-bot-providers-test.json";

const INLINE = JSON.stringify({
  provider: "deepseek",
  model: "deepseek-v4-pro",
  providers: {
    deepseek: { type: "deepseek", api_key: "k", base_url: "https://api.deepseek.com", models: ["deepseek-v4-pro"] }
  }
});

describe("readBotProvidersRaw（配置来源优先级）", () => {
  it("BOT_PROVIDERS 内联 JSON 优先,且不读文件", () => {
    expect(readBotProvidersRaw({ BOT_PROVIDERS: INLINE, BOT_PROVIDERS_FILE: NO_FILE })).toBe(INLINE);
  });

  it("无内联且文件不存在时返回 null", () => {
    expect(readBotProvidersRaw({ BOT_PROVIDERS_FILE: NO_FILE })).toBeNull();
  });

  it("空白内联视作未设置(回落到文件,这里文件不存在 → null)", () => {
    expect(readBotProvidersRaw({ BOT_PROVIDERS: "   ", BOT_PROVIDERS_FILE: NO_FILE })).toBeNull();
  });
});

describe("loadBotProviderRegistry", () => {
  it("用 BOT_PROVIDERS 内联 JSON 构建注册表", () => {
    const registry = loadBotProviderRegistry({ BOT_PROVIDERS: INLINE, BOT_PROVIDERS_FILE: NO_FILE });
    expect(registry.default).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(registry.providers.deepseek?.type).toBe("deepseek");
  });

  it("无配置时用 ANTHROPIC_API_KEY 合成默认 anthropic", () => {
    const registry = loadBotProviderRegistry({ BOT_PROVIDERS_FILE: NO_FILE, ANTHROPIC_API_KEY: "k" });
    expect(registry.default).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(registry.providers.anthropic?.apiKey).toBe("k");
  });

  it("内联非法 JSON 显式抛错(启动即失败)", () => {
    expect(() => loadBotProviderRegistry({ BOT_PROVIDERS: "{bad", BOT_PROVIDERS_FILE: NO_FILE })).toThrow();
  });
});
