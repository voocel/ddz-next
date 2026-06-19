import { describe, expect, it } from "vitest";
import {
  commentaryConfigFromEnv,
  decisionConfigFromEnv,
  LlmCommentator,
  NullCommentator,
  sanitizeComment
} from "../src";

describe("sanitizeComment", () => {
  it("去掉首尾引号和空白并压成单行", () => {
    expect(sanitizeComment('  “这把稳了”\n ', 40)).toBe("这把稳了");
    expect(sanitizeComment("地主\t你   完了", 40)).toBe("地主 你 完了");
  });

  it("按上限截断", () => {
    expect(sanitizeComment("一二三四五六", 3)).toBe("一二三");
  });

  it("空白/空串返回 null", () => {
    expect(sanitizeComment("   ", 40)).toBeNull();
    expect(sanitizeComment("", 40)).toBeNull();
  });
});

describe("NullCommentator", () => {
  it("永远返回 null", async () => {
    await expect(new NullCommentator().comment()).resolves.toBeNull();
  });
});

describe("LlmCommentator", () => {
  it("model 为 null(缺密钥/未配置)时静默返回 null,不发起请求", async () => {
    const commentator = new LlmCommentator({ model: null });
    await expect(
      commentator.comment({
        persona: "毒舌",
        selfNickname: "机器人1",
        role: "landlord",
        event: "打出了炸弹(4 张)",
        selfHandCount: 5,
        opponentHandCounts: [8, 9]
      })
    ).resolves.toBeNull();
  });
});

describe("commentaryConfigFromEnv", () => {
  it("默认关闭并给出兜底配置", () => {
    const config = commentaryConfigFromEnv({});
    expect(config.enabled).toBe(false);
    expect(config.timeoutMs).toBe(4000);
    expect(config.maxChars).toBe(40);
  });

  it("BOT_CHAT_ENABLED=true 才启用,其余可覆盖", () => {
    const config = commentaryConfigFromEnv({
      BOT_CHAT_ENABLED: "true",
      BOT_CHAT_PERSONA: "稳健",
      BOT_CHAT_TIMEOUT_MS: "8000",
      BOT_CHAT_MAX_CHARS: "20"
    });
    expect(config.enabled).toBe(true);
    expect(config.persona).toBe("稳健");
    expect(config.timeoutMs).toBe(8000);
    expect(config.maxChars).toBe(20);
  });

  it("非法数字回退到默认", () => {
    const config = commentaryConfigFromEnv({ BOT_CHAT_TIMEOUT_MS: "abc", BOT_CHAT_MAX_CHARS: "-5" });
    expect(config.timeoutMs).toBe(4000);
    expect(config.maxChars).toBe(40);
  });
});

describe("decisionConfigFromEnv", () => {
  it("默认用规则 bot,给出兜底超时(对推理模型够用)", () => {
    const config = decisionConfigFromEnv({});
    expect(config.useLlm).toBe(false);
    expect(config.timeoutMs).toBe(60000);
    expect(config.reasoningEffort).toBe("off");
  });

  it("BOT_DECISION=llm 才启用,超时可覆盖", () => {
    const config = decisionConfigFromEnv({
      BOT_DECISION: "llm",
      BOT_DECISION_TIMEOUT_MS: "12000"
    });
    expect(config.useLlm).toBe(true);
    expect(config.timeoutMs).toBe(12000);
  });

  it("BOT_REASONING_EFFORT 可显式切回模型默认或指定强度", () => {
    expect(decisionConfigFromEnv({ BOT_REASONING_EFFORT: "auto" }).reasoningEffort).toBe("auto");
    expect(decisionConfigFromEnv({ BOT_REASONING_EFFORT: "high" }).reasoningEffort).toBe("high");
  });
});
