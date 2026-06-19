import { parseReasoningEffort, type ReasoningEffort } from "./reasoning.js";

/**
 * 解说与决策的「行为开关」配置。模型的选择不在这里:模型由供应商注册表(registry.ts)
 * 统一管理,调用方按 registry.default 或房间内所选 ModelRef 解析,实现注册表单一事实源。
 */
export interface CommentaryConfig {
  readonly enabled: boolean;
  readonly persona: string;
  readonly timeoutMs: number;
  readonly maxChars: number;
}

export interface DecisionConfig {
  /** true 时出牌相位交给 LLM 决策(叫/抢地主仍用规则,隔离实验变量);默认 false 用规则 bot。 */
  readonly useLlm: boolean;
  readonly timeoutMs: number;
  /** 思考强度档位(默认 off,避免 DeepSeek V4 默认长思考吞掉最终编号);客户端建房可覆盖。 */
  readonly reasoningEffort: ReasoningEffort;
}

const DEFAULT_PERSONA = "爱炫耀、嘴上不饶人但心态好的老牌玩家";
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_CHARS = 40;
// 出牌决策默认超时:前沿/推理模型(gpt-5.5、o 系、deepseek thinking 等)单步思考动辄十几秒,
// 给足 60s 头寸,避免误把「还在想」当失败。BOT_DECISION_TIMEOUT_MS 可覆盖。
// 注意:bot 回合不受面向真人的回合超时管辖(见 roomTurnScheduler),这是 bot 唯一的决策时钟,
// 超时即 abort 抛错暴露(不回退规则),与「纯 LLM 实验」一致。
const DEFAULT_DECISION_TIMEOUT_MS = 60_000;
// 出牌决策只需要在合法候选中选编号；默认关闭 thinking，减少 DeepSeek 把 token 全耗在 reasoning 的概率。
const DEFAULT_DECISION_REASONING_EFFORT: ReasoningEffort = "off";

/**
 * 从环境变量读取解说配置。默认关闭;只有 BOT_CHAT_ENABLED=true 才启用。
 * 解说使用注册表默认模型(registry.default),缺密钥时 LlmCommentator 仍会静默降级。
 */
export function commentaryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CommentaryConfig {
  return {
    enabled: env.BOT_CHAT_ENABLED === "true",
    persona: env.BOT_CHAT_PERSONA ?? DEFAULT_PERSONA,
    timeoutMs: positiveIntOr(env.BOT_CHAT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxChars: positiveIntOr(env.BOT_CHAT_MAX_CHARS, DEFAULT_MAX_CHARS)
  };
}

/**
 * 从环境变量读取决策配置。默认规则 bot;BOT_DECISION=llm 才用大模型出牌。
 * 启用后是「纯 LLM 出牌」:缺密钥/失败/超时一律抛错暴露,绝不回退规则 bot(叫/抢仍走固定策略以隔离实验变量)。
 */
export function decisionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DecisionConfig {
  return {
    useLlm: env.BOT_DECISION === "llm",
    timeoutMs: positiveIntOr(env.BOT_DECISION_TIMEOUT_MS, DEFAULT_DECISION_TIMEOUT_MS),
    reasoningEffort:
      env.BOT_REASONING_EFFORT === undefined
        ? DEFAULT_DECISION_REASONING_EFFORT
        : parseReasoningEffort(env.BOT_REASONING_EFFORT)
  };
}

function positiveIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
