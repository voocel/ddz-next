import type { JSONValue } from "ai";
import type { ProviderType } from "./registry.js";

/**
 * 可移植的「思考强度」档位:供前端设置、服务端默认与决策装配统一表达。
 * - auto:不干预,跟随模型默认(零行为变化)。
 * - off:尽量关闭思考(Anthropic/DeepSeek/MiMo 可显式关闭;通用 openai-compatible 退化为最低档,见下)。
 * - low/medium/high:思考强度由低到高。
 * provider 差异(Anthropic 的 effort/thinking vs openai-compatible 的 reasoningEffort)只在
 * buildReasoningProviderOptions 一处收敛,chooser 与上层都只传这个档位字符串。
 */
export type ReasoningEffort = "auto" | "off" | "low" | "medium" | "high";

const REASONING_EFFORTS: readonly ReasoningEffort[] = ["auto", "off", "low", "medium", "high"];

export interface ReasoningRequestControls {
  readonly thinking?: { readonly type: "enabled" | "disabled" } | undefined;
  readonly reasoning_effort?: "high" | "max" | undefined;
}

/** 校验任意输入为合法档位,非法(含 undefined)一律回退 auto。供服务端校验不可信的客户端入参。 */
export function parseReasoningEffort(raw: unknown): ReasoningEffort {
  return typeof raw === "string" && (REASONING_EFFORTS as readonly string[]).includes(raw)
    ? (raw as ReasoningEffort)
    : "auto";
}

/** streamText 的 providerOptions 形状(provider key → 该 provider 的选项),与 SDK 的 JSONValue 对齐。 */
export type ReasoningProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * 把一个档位翻译成 DeepSeek 官方 OpenAI 格式的请求体控制字段。
 * 官方文档:thinking 默认 enabled;关闭必须显式传顶层 `thinking:{"type":"disabled"}`。
 * low/medium 为兼容档,服务端会映射到 high;xhigh 才映射 max,本项目不暴露 xhigh。
 */
export function buildDeepSeekRequestControls(effort: ReasoningEffort): ReasoningRequestControls | undefined {
  if (effort === "auto") {
    return undefined;
  }
  if (effort === "off") {
    return { thinking: { type: "disabled" } };
  }
  return { thinking: { type: "enabled" }, reasoning_effort: "high" };
}

/**
 * MiMo 官方只支持开/关深度思考:顶层 `thinking.type=enabled|disabled`。
 * low/medium/high 都只能映射为 enabled;auto 不干预,让模型按默认值运行。
 */
export function buildMiMoRequestControls(effort: ReasoningEffort): ReasoningRequestControls | undefined {
  if (effort === "auto") {
    return undefined;
  }
  return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
}

/**
 * 把一个档位翻译成对应 provider 的 streamText.providerOptions;auto 返回 undefined(完全不干预)。
 *
 * - Anthropic(`@ai-sdk/anthropic`):关闭走 `thinking:{type:"disabled"}`;
 *   非 off 档位显式请求 `adaptive + summarized`,否则只传 effort 不会返回可见 reasoning 文本。
 *   刻意不用 `thinking:{type:"enabled",budgetTokens}`——它在 Opus 4.7+(含本项目 claude-opus-4-8)会 400。
 * - DeepSeek:V4 双模最终在 provider.transformRequestBody 注入顶层 `thinking` / `reasoning_effort`;
 *   这里仍保留 providerOptions 摘要,供 trace 证明本手档位,不依赖它作为唯一落点。
 * - MiMo:官方只支持 `thinking.type=enabled|disabled`,没有 low/medium/high 强度档。
 *   因此 off=disabled,low/medium/high=enabled,auto=不干预。
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
    return { anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort } };
  }
  if (providerType === "deepseek") {
    const controls = buildDeepSeekRequestControls(effort);
    if (!controls) {
      return undefined;
    }
    const options: Record<string, JSONValue> = {};
    if (controls.thinking) {
      options.thinking = controls.thinking;
    }
    if (controls.reasoning_effort) {
      options.reasoning_effort = controls.reasoning_effort;
    }
    return { deepseek: options };
  }
  if (providerType === "mimo") {
    const controls = buildMiMoRequestControls(effort);
    if (!controls?.thinking) {
      return undefined;
    }
    return { mimo: { thinking: controls.thinking } };
  }
  return { [providerKey]: { reasoningEffort: effort === "off" ? "low" : effort } };
}
