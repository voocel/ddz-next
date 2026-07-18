import { generateText, type LanguageModel } from "ai";

/** 解说所需的公开局势(由调用方从快照映射,bot-ai 不依赖游戏内部类型)。 */
export interface CommentaryContext {
  /** 机器人性格,如「爱炫耀、嘴上不饶人的老牌玩家」。 */
  readonly persona: string;
  readonly selfNickname: string;
  readonly role: "landlord" | "farmer";
  /** 刚发生的事(中文短句),如「打出了炸弹(4 张)」。 */
  readonly event: string;
  readonly selfHandCount: number;
  readonly opponentHandCounts: readonly number[];
}

export interface Commentator {
  /** 生成一句应景台词;无话可说/失败/无 key 时返回 null。 */
  comment(ctx: CommentaryContext): Promise<string | null>;
}

/** 关闭解说时使用:永远不说话。 */
export class NullCommentator implements Commentator {
  comment(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

export interface LlmCommentatorOptions {
  /** 已由供应商注册表解析好的语言模型;为 null(缺密钥/未配置)时静默返回 null。 */
  readonly model: LanguageModel | null;
  readonly timeoutMs?: number;
  readonly maxChars?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_CHARS = 40;

/** 调用 LLM 生成台词;任何异常(超时/限流/无 key)都吞掉返回 null,纯装饰不影响对局。 */
export class LlmCommentator implements Commentator {
  constructor(private readonly options: LlmCommentatorOptions) {}

  async comment(ctx: CommentaryContext): Promise<string | null> {
    const model = this.options.model;
    if (!model) {
      return null;
    }

    const maxChars = this.options.maxChars ?? DEFAULT_MAX_CHARS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const { text } = await generateText({
        model,
        system: buildSystem(ctx.persona, maxChars),
        prompt: buildPrompt(ctx),
        maxOutputTokens: 96,
        abortSignal: controller.signal
      });
      return sanitizeComment(text, maxChars);
    } catch (error) {
      // 台词纯装饰,吞错不影响对局;但留一行告警,否则台词模型挂了无从察觉
      console.warn("[LlmCommentator] 台词生成失败(已跳过):", error instanceof Error ? error.message : error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 清洗 LLM 输出:去引号/空白、压成单行、按上限截断;空串返回 null。导出供单测。 */
export function sanitizeComment(raw: string, maxChars: number): string | null {
  const line = raw
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .trim();
  if (!line) {
    return null;
  }
  return line.length > maxChars ? line.slice(0, maxChars) : line;
}

function buildSystem(persona: string, maxChars: number): string {
  return [
    `你是斗地主牌桌上的一个机器人玩家,性格:${persona}。`,
    `根据当前局势说一句应景的中文台词,像真人一样插科打诨、挑衅、得意或自嘲。`,
    `要求:只输出台词本身,不超过${maxChars}个字,不要引号、不要解释、不要堆叠表情符号。`
  ].join("");
}

function buildPrompt(ctx: CommentaryContext): string {
  const roleLabel = ctx.role === "landlord" ? "地主" : "农民";
  const opponents = ctx.opponentHandCounts.join("、");
  return [
    `你是${ctx.selfNickname},当前是${roleLabel}。`,
    `刚刚:${ctx.event}。`,
    `你手里还剩${ctx.selfHandCount}张牌,其他玩家分别剩${opponents}张。`,
    `说一句:`
  ].join("\n");
}
