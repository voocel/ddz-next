import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { parseBotProviderRegistry, resolveModel } from "../src";

function deepseekRegistry() {
  return parseBotProviderRegistry(
    JSON.stringify({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      providers: {
        deepseek: {
          type: "deepseek",
          api_key: "sk-test",
          base_url: "https://api.deepseek.com",
          models: ["deepseek-v4-flash"]
        }
      }
    })
  );
}

function mimoRegistry() {
  return parseBotProviderRegistry(
    JSON.stringify({
      provider: "mimo",
      model: "mimo-v2.5-pro",
      providers: {
        mimo: {
          type: "mimo",
          api_key: "tp-test",
          base_url: "https://token-plan-cn.xiaomimimo.com/v1",
          models: ["mimo-v2.5-pro"]
        }
      }
    })
  );
}

function anthropicRegistry(baseURL = "https://proxy.example/v1") {
  return parseBotProviderRegistry(
    JSON.stringify({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      providers: {
        anthropic: {
          type: "anthropic",
          api_key: "sk-ant-test",
          base_url: baseURL,
          models: ["claude-sonnet-4-6"]
        }
      }
    })
  );
}

describe("resolveModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anthropic:base_url 是 API 前缀,SDK 会在其后拼 /messages", async () => {
    const model = resolveModel({ provider: "anthropic", model: "claude-sonnet-4-6" }, anthropicRegistry()) as LanguageModelV2;
    const urls: string[] = [];
    const captured: unknown[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      captured.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      maxOutputTokens: 1024,
      abortSignal: undefined,
      headers: undefined
    });

    expect(urls[0]).toBe("https://proxy.example/v1/messages");
    expect(captured[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      stream: true,
      max_tokens: 1024
    });
  });

  it("deepseek:reasoningEffort=off 时最终请求体带 thinking.disabled", async () => {
    const model = resolveModel({ provider: "deepseek", model: "deepseek-v4-flash" }, deepseekRegistry(), {
      reasoningEffort: "off"
    }) as LanguageModelV2;
    const captured: unknown[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      abortSignal: undefined,
      headers: undefined
    });

    expect(captured[0]).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      thinking: { type: "disabled" }
    });
  });

  it("mimo:reasoningEffort=off 时最终请求体带官方 thinking.disabled", async () => {
    const model = resolveModel({ provider: "mimo", model: "mimo-v2.5-pro" }, mimoRegistry(), {
      reasoningEffort: "off"
    }) as LanguageModelV2;
    const captured: unknown[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      abortSignal: undefined,
      headers: undefined
    });

    expect(captured[0]).toMatchObject({
      model: "mimo-v2.5-pro",
      stream: true,
      thinking: { type: "disabled" }
    });
  });

  it("mimo:请求头带官方 api-key,兼容 Token Plan 鉴权", async () => {
    const model = resolveModel({ provider: "mimo", model: "mimo-v2.5-pro" }, mimoRegistry(), {
      reasoningEffort: "off"
    }) as LanguageModelV2;
    const headers: Headers[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      headers.push(new Headers(init?.headers));
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      abortSignal: undefined,
      headers: undefined
    });

    expect(headers[0]?.get("api-key")).toBe("tp-test");
  });

  it("mimo:reasoningEffort=high 时最终请求体带官方 thinking.enabled", async () => {
    const model = resolveModel({ provider: "mimo", model: "mimo-v2.5-pro" }, mimoRegistry(), {
      reasoningEffort: "high"
    }) as LanguageModelV2;
    const captured: unknown[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      abortSignal: undefined,
      headers: undefined
    });

    expect(captured[0]).toMatchObject({
      model: "mimo-v2.5-pro",
      stream: true,
      thinking: { type: "enabled" }
    });
  });

  it("mimo:reasoningEffort=auto 时不注入 thinking,完全跟随模型默认", async () => {
    const model = resolveModel({ provider: "mimo", model: "mimo-v2.5-pro" }, mimoRegistry(), {
      reasoningEffort: "auto"
    }) as LanguageModelV2;
    const captured: unknown[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    };
    vi.stubGlobal("fetch", fetch);

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "只回复 1" }] }],
      providerOptions: {},
      abortSignal: undefined,
      headers: undefined
    });

    expect(captured[0]).toMatchObject({
      model: "mimo-v2.5-pro",
      stream: true
    });
    expect(captured[0]).not.toMatchObject({ thinking: expect.anything() });
  });
});
