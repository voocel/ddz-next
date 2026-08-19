import { describe, expect, it } from "vitest";
import { parseBotProviderRegistry } from "@ddz/bot-ai";
import { lineupBotNicknames, readLineup } from "../../src/rooms/roomOptions";

const registry = parseBotProviderRegistry(
  JSON.stringify({
    provider: "anthropic",
    model: "model-a",
    providers: { anthropic: { type: "anthropic", api_key: "k", models: ["model-a", "model-b"] } }
  })
);

const ref = (model: string) => ({ provider: "anthropic", model });

describe("readLineup", () => {
  it("按席位数校验:3 席竞技场/2 席挑战桌各自通过", () => {
    expect(readLineup([ref("model-a"), ref("model-b"), ref("model-a")], registry, 3)).toHaveLength(3);
    expect(readLineup([ref("model-a"), ref("model-b")], registry, 2)).toHaveLength(2);
  });

  it("席位数不匹配即拒绝(不截断不补默认)", () => {
    expect(() => readLineup([ref("model-a"), ref("model-b")], registry, 3)).toThrow(/恰好 3 个/);
    expect(() => readLineup([ref("model-a"), ref("model-b"), ref("model-a")], registry, 2)).toThrow(/恰好 2 个/);
    expect(() => readLineup(undefined, registry, 2)).toThrow(/恰好 2 个/);
  });

  it("注册表外模型与畸形席位都显式拒绝", () => {
    expect(() => readLineup([ref("model-a"), ref("nope")], registry, 2)).toThrow(/不在服务端允许的模型列表/);
    expect(() => readLineup([ref("model-a"), { provider: "", model: "model-b" }], registry, 2)).toThrow(/非空字符串/);
  });
});

describe("lineupBotNicknames", () => {
  it("昵称用模型名,同模型追加 #2/#3", () => {
    expect(lineupBotNicknames([ref("model-a"), ref("model-b"), ref("model-a")])).toEqual([
      "model-a",
      "model-b",
      "model-a#2"
    ]);
  });
});
