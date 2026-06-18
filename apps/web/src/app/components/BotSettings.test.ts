import { describe, expect, it } from "vitest";
import type { BotModelOption } from "@ddz/protocol";
import { describeDefault } from "./BotSettings";

const MODELS: BotModelOption[] = [
  { provider: "deepseek", model: "deepseek-v4-pro", providerLabel: "DeepSeek" },
  { provider: "anthropic", model: "claude-haiku-4-5", providerLabel: "Anthropic" }
];

describe("describeDefault（设置里「服务端默认」的具体标注）", () => {
  it("默认模型在清单里时显示 providerLabel · model", () => {
    expect(describeDefault({ provider: "deepseek", model: "deepseek-v4-pro" }, MODELS)).toBe(
      "服务端默认（DeepSeek · deepseek-v4-pro）"
    );
  });

  it("默认模型不在清单里时回退用 provider · model 原样显示", () => {
    expect(describeDefault({ provider: "mimo", model: "mimo-v2.5" }, MODELS)).toBe("服务端默认（mimo · mimo-v2.5）");
  });

  it("无默认(未拉到/未配置)时退化为「服务端默认」", () => {
    expect(describeDefault(null, MODELS)).toBe("服务端默认");
    expect(describeDefault({ provider: "", model: "" }, MODELS)).toBe("服务端默认");
    expect(describeDefault(undefined, MODELS)).toBe("服务端默认");
  });
});
