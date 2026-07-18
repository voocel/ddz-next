import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, type LanguageModel } from "ai";
import {
  buildArenaCommentarySystem,
  formatArenaCommentaryPrompt,
  LlmArenaCommentator,
  NullArenaCommentator,
  type ArenaCommentaryContext
} from "../src";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateText: vi.fn() };
});

const generateTextMock = vi.mocked(generateText);

beforeEach(() => {
  generateTextMock.mockReset();
});

const context: ArenaCommentaryContext = {
  seats: [
    { nickname: "claude-sonnet-5", model: "claude-sonnet-5", role: "landlord", handCount: 12, score: 4 },
    { nickname: "kimi-k2", model: "kimi-k2", role: "farmer", handCount: 15, score: -2 },
    { nickname: "deepseek-v4", model: "deepseek-v4", role: "farmer", handCount: 17, score: -2 }
  ],
  event: "claude-sonnet-5 打出火箭,倍数翻到 8 倍",
  multiplier: 8,
  recentActions: ["kimi-k2 出了单张A", "claude-sonnet-5 出了火箭"]
};

describe("formatArenaCommentaryPrompt", () => {
  it("包含阵容(昵称/模型/身份/剩牌/累计分)、倍数、最近动作与事件", () => {
    const prompt = formatArenaCommentaryPrompt(context);

    expect(prompt).toContain("claude-sonnet-5(claude-sonnet-5):地主,剩 12 张,累计 4 分");
    expect(prompt).toContain("kimi-k2(kimi-k2):农民,剩 15 张,累计 -2 分");
    expect(prompt).toContain("【倍数】8 倍");
    expect(prompt).toContain("kimi-k2 出了单张A");
    expect(prompt).toContain("【刚刚】claude-sonnet-5 打出火箭,倍数翻到 8 倍");
  });

  it("身份未定与空模型名的席位正常渲染", () => {
    const prompt = formatArenaCommentaryPrompt({
      ...context,
      seats: [{ nickname: "神秘选手", model: "", role: "undecided", handCount: 17, score: 0 }],
      recentActions: []
    });

    expect(prompt).toContain("- 神秘选手:身份未定,剩 17 张,累计 0 分");
    expect(prompt).not.toContain("【最近动作】");
  });
});

describe("buildArenaCommentarySystem", () => {
  it("声明解说角色与字数约束", () => {
    const system = buildArenaCommentarySystem(200);
    expect(system).toContain("赛事解说员");
    expect(system).toContain("不超过200个字");
  });
});

describe("LlmArenaCommentator", () => {
  it("model 为 null(缺密钥/显式关闭)时静默返回 null,不发起请求", async () => {
    const commentator = new LlmArenaCommentator({ model: null });
    await expect(commentator.comment(context)).resolves.toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("清洗模型输出(去引号/截断)", async () => {
    generateTextMock.mockResolvedValueOnce({ text: '"这一手火箭直接点燃全场!"' } as Awaited<
      ReturnType<typeof generateText>
    >);
    const commentator = new LlmArenaCommentator({ model: {} as LanguageModel });

    await expect(commentator.comment(context)).resolves.toBe("这一手火箭直接点燃全场!");
  });

  it("请求失败吞错返回 null(纯装饰不影响对局)", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("rate limited"));
    const commentator = new LlmArenaCommentator({ model: {} as LanguageModel });

    await expect(commentator.comment(context)).resolves.toBeNull();
  });
});

describe("NullArenaCommentator", () => {
  it("永远沉默", async () => {
    await expect(new NullArenaCommentator().comment()).resolves.toBeNull();
  });
});
