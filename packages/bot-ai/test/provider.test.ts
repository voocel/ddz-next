import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { buildReasoningProviderOptions, LlmMoveChooser, parseBotProviderRegistry, resolveModel } from "../src";

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

function newApiGatewayRegistry() {
  return parseBotProviderRegistry(
    JSON.stringify({
      provider: "wool",
      model: "claude-sonnet-4-6",
      providers: {
        wool: {
          type: "openai-compatible",
          api_key: "sk-test",
          base_url: "https://wzw.pp.ua/v1",
          models: ["claude-sonnet-4-6"]
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

function anthropicClaudeCodeRegistry() {
  return parseBotProviderRegistry(
    JSON.stringify({
      provider: "wool",
      model: "claude-sonnet-4-6",
      providers: {
        wool: {
          type: "anthropic",
          api_key: "sk-ant-test",
          base_url: "https://wzw.pp.ua/v1",
          user_agent: "claude-code/2.1.183",
          anthropic_beta: "claude-code-20250219",
          headers: {
            "X-Stainless-Lang": "js",
            "X-Stainless-Package-Version": "0.94.0",
            "X-Stainless-Runtime": "node"
          },
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

  it("anthropic:支持显式 User-Agent、anthropic-beta 与额外 headers", async () => {
    const model = resolveModel({ provider: "wool", model: "claude-sonnet-4-6" }, anthropicClaudeCodeRegistry()) as LanguageModelV2;
    const urls: string[] = [];
    const headers: Headers[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
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
      maxOutputTokens: 1024,
      abortSignal: undefined,
      headers: undefined
    });

    expect(urls[0]).toBe("https://wzw.pp.ua/v1/messages");
    expect(headers[0]?.get("user-agent")).toContain("claude-code/2.1.183");
    expect(headers[0]?.get("user-agent")).toContain("ai-sdk/anthropic/");
    expect(headers[0]?.get("anthropic-beta")).toBe("claude-code-20250219");
    expect(headers[0]?.get("x-stainless-lang")).toBe("js");
    expect(headers[0]?.get("x-stainless-package-version")).toBe("0.94.0");
    expect(headers[0]?.get("x-stainless-runtime")).toBe("node");
    expect(headers[0]?.get("x-api-key")).toBe("sk-ant-test");
  });

  it("anthropic:high 档会在最终请求体显式请求可见 thinking 并带 effort", async () => {
    const model = resolveModel({ provider: "wool", model: "claude-sonnet-4-6" }, anthropicClaudeCodeRegistry()) as LanguageModelV2;
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
      providerOptions: buildReasoningProviderOptions("anthropic", "wool", "high") ?? {},
      maxOutputTokens: 1024,
      abortSignal: undefined,
      headers: undefined
    });

    expect(captured[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      stream: true,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" }
    });
  });

  it("New API 聚合网关即使承载 Claude 模型,也必须走 openai-compatible /chat/completions", async () => {
    const model = resolveModel(
      { provider: "wool", model: "claude-sonnet-4-6" },
      newApiGatewayRegistry()
    ) as LanguageModelV2;
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
      providerOptions: { wool: { reasoningEffort: "low" } },
      abortSignal: undefined,
      headers: undefined
    });

    expect(urls[0]).toBe("https://wzw.pp.ua/v1/chat/completions");
    expect(captured[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      stream: true,
      reasoning_effort: "low"
    });
  });

  it("LLM trace 记录完整上游 HTTP 请求/响应,请求密钥脱敏", async () => {
    const model = resolveModel(
      { provider: "wool", model: "claude-sonnet-4-6" },
      newApiGatewayRegistry()
    );
    const rawBody = 'data: {"choices":[{"delta":{"content":"2"}}]}\n\ndata: [DONE]\n\n';
    const fetch = async (): Promise<Response> =>
      new Response(rawBody, {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/event-stream", "x-oneapi-request-id": "req-trace" }
      });
    vi.stubGlobal("fetch", fetch);

    const decision = await new LlmMoveChooser({
      model,
      provider: { key: "wool", type: "openai-compatible", baseURL: "https://wzw.pp.ua/v1" }
    }).choose({
      role: "landlord",
      hand: ["3"],
      playedCards: [],
      opponents: [
        { label: "农民", handCount: 17, revealedCards: [] },
        { label: "农民", handCount: 17, revealedCards: [] }
      ],
      lastPlay: null,
      candidates: ["单张3", "单张4"]
    });

    const entry = decision?.trace.httpTrace?.requests[0];
    expect(entry?.url).toBe("https://wzw.pp.ua/v1/chat/completions");
    expect(entry?.request.headers?.authorization).toBe("[redacted]");
    expect(entry?.request.body).toContain('"model":"claude-sonnet-4-6"');
    expect(entry?.response).toMatchObject({
      status: 200,
      statusText: "OK",
      headers: expect.objectContaining({ "x-oneapi-request-id": "req-trace" }),
      body: rawBody,
      bodyLength: rawBody.length
    });
    expect(JSON.stringify(decision?.trace.httpTrace)).not.toContain("sk-test");
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
