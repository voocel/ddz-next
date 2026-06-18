import type { JSONValue } from "ai";
import type { ProviderType } from "./registry.js";

/**
 * 可移植的「思考强度」档位:供前端设置、服务端默认与决策装配统一表达。
 * - auto:不干预,跟随模型默认(零行为变化)。
 * - off:尽量关闭思考(Anthropic 可显式关闭;openai-compatible 退化为最低档,见下)。
 * - low/medium/high:思考强度由低到高。
 * provider 差异(Anthropic 的 effort/thinking vs openai-compatible 的 reasoningEffort)只在
 * buildReasoningProviderOptions 一处收敛,chooser 与上层都只传这个档位字符串。
 */
export type ReasoningEffort = "auto" | "off" | "low" | "medium" | "high";

const REASONING_EFFORTS: readonly ReasoningEffort[] = ["auto", "off", "low", "medium", "high"];

/** 校验任意输入为合法档位,非法(含 undefined)一律回退 auto。供服务端校验不可信的客户端入参。 */
export function parseReasoningEffort(raw: unknown): ReasoningEffort {
  return typeof raw === "string" && (REASONING_EFFORTS as readonly string[]).includes(raw)
    ? (raw as ReasoningEffort)
    : "auto";
}

/** generateText 的 providerOptions 形状(provider key → 该 provider 的选项),与 SDK 的 JSONValue 对齐。 */
export type ReasoningProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * 把一个档位翻译成对应 provider 的 generateText.providerOptions;auto 返回 undefined(完全不干预)。
 *
 * - Anthropic(`@ai-sdk/anthropic`):强度走 `effort`(跨模型代际通用),关闭走 `thinking:{type:"disabled"}`。
 *   刻意不用 `thinking:{type:"enabled",budgetTokens}`——它在 Opus 4.7+(含本项目 claude-opus-4-8)会 400。
 * - DeepSeek(`@ai-sdk/deepseek`):V4 双模——关闭走 `thinking:{type:"disabled"}`,强度走 `reasoningEffort`。
 *   注意 DeepSeek 服务端把 low/medium 映射到 high(只有 关闭 / 高·max 真正不同);providerOptions 键固定为 "deepseek"。
 * - openai-compatible(OpenAI / 本地等):走 `reasoningEffort`(键为 provider 名,与 createOpenAICompatible 的 name 一致)。
 *   该协议无可靠通用的「关闭」,off 退化为最低档 low。
 */
export function buildReasoningProviderOptions(
  providerType: ProviderType,
  providerKey: string,
  effort: ReasoningEffort
): ReasoningProviderOptions | undefined {
  if (effort === "auto") {
    return undefined;
  }
  if (providerType === "anthropic") {
    if (effort === "off") {
      return { anthropic: { thinking: { type: "disabled" } } };
    }
    return { anthropic: { effort } };
  }
  if (providerType === "deepseek") {
    if (effort === "off") {
      return { deepseek: { thinking: { type: "disabled" } } };
    }
    return { deepseek: { reasoningEffort: effort } };
  }
  return { [providerKey]: { reasoningEffort: effort === "off" ? "low" : effort } };
}
