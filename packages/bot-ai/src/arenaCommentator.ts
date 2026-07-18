import { generateText, type LanguageModel } from "ai";
import { sanitizeComment } from "./commentator.js";

/**
 * 竞技场赛事解说:全局旁白视角的短句字幕(非流式),与 commentator.ts 的机器人第一人称台词是不同内容层。
 * 纯装饰:任何失败(超时/限流/缺 key)都吞掉返回 null,绝不影响对局。
 */

/** 一个席位的公开信息(由调用方从快照映射,bot-ai 不依赖游戏内部类型)。 */
export interface ArenaCommentarySeat {
  readonly nickname: string;
  /** 该席位的模型名(如 claude-sonnet-5);未知时传空串,prompt 不展示。 */
  readonly model: string;
  readonly role: "landlord" | "farmer" | "undecided";
  readonly handCount: number;
  /** 跨局累计分,解说据此讲战局大势。 */
  readonly score: number;
}

export interface ArenaCommentaryContext {
  readonly seats: readonly ArenaCommentarySeat[];
  /** 刚发生的事(中文短句),如「Kimi 打出了火箭」「本局结束,地主获胜」。 */
  readonly event: string;
  readonly multiplier: number;
  /** 最近几手的中文描述(带昵称),给解说提供短程记忆;可为空。 */
  readonly recentActions: readonly string[];
}

export interface ArenaCommentator {
  /** 生成一句赛事解说;无话可说/失败/无 key 时返回 null。 */
  comment(ctx: ArenaCommentaryContext): Promise<string | null>;
}

/** 关闭解说时使用:永远沉默。 */
export class NullArenaCommentator implements ArenaCommentator {
  comment(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

export interface LlmArenaCommentatorOptions {
  /** 已由供应商注册表解析好的语言模型;为 null(缺密钥/未配置)时静默返回 null。 */
  readonly model: LanguageModel | null;
  readonly timeoutMs?: number;
  readonly maxChars?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_CHARS = 200;

export class LlmArenaCommentator implements ArenaCommentator {
  constructor(private readonly options: LlmArenaCommentatorOptions) {}

  async comment(ctx: ArenaCommentaryContext): Promise<string | null> {
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
        system: buildArenaCommentarySystem(maxChars),
        prompt: formatArenaCommentaryPrompt(ctx),
        maxOutputTokens: 256,
        abortSignal: controller.signal
      });
      return sanitizeComment(text, maxChars);
    } catch (error) {
      // 解说纯装饰,吞错不影响对局;但留一行告警,否则解说模型挂了无从察觉
      console.warn("[LlmArenaCommentator] 解说生成失败(已跳过):", error instanceof Error ? error.message : error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 导出供单测校验解说约束。 */
export function buildArenaCommentarySystem(maxChars: number): string {
  return [
    "你是「AI 斗地主竞技场」的赛事解说员,正在直播三个大模型 AI 同桌斗地主。",
    "根据刚发生的事解说一两句:点评关键抉择、渲染局势张力,可以适度调侃模型的风格,像电竞解说一样有感染力。",
    `要求:只输出解说词本身,不超过${maxChars}个字,单段不分行,不要引号、不要前缀、不要罗列数据。`
  ].join("");
}

/** 导出供单测校验 prompt 内容。 */
export function formatArenaCommentaryPrompt(ctx: ArenaCommentaryContext): string {
  const lines: string[] = ["【选手】"];
  for (const seat of ctx.seats) {
    const model = seat.model ? `(${seat.model})` : "";
    const role = seat.role === "landlord" ? "地主" : seat.role === "farmer" ? "农民" : "身份未定";
    lines.push(`- ${seat.nickname}${model}:${role},剩 ${seat.handCount} 张,累计 ${seat.score} 分`);
  }
  lines.push(`【倍数】${ctx.multiplier} 倍`);
  if (ctx.recentActions.length > 0) {
    lines.push("【最近动作】");
    for (const action of ctx.recentActions) {
      lines.push(`- ${action}`);
    }
  }
  lines.push(`【刚刚】${ctx.event}`);
  lines.push("请解说:");
  return lines.join("\n");
}
