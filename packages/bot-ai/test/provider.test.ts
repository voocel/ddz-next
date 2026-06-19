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

describe("resolveModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
