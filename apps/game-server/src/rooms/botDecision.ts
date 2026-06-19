import {
  buildReasoningProviderOptions,
  decisionConfigFromEnv,
  isAllowedModel,
  LlmMoveChooser,
  parseReasoningEffort,
  resolveModel,
  type BotProviderRegistry,
  type DecisionConfig,
  type ModelRef,
  type MoveStreamDelta,
  type ReasoningEffort
} from "@ddz/bot-ai";
import type { BotBrain } from "./botBrain.js";
import { RuleBotBrain } from "./ruleBotBrain.js";
import {
  LlmBotBrain,
  type LlmDecisionChoice,
  type LlmDecisionMetric,
  type LlmDecisionTrace
} from "./llmBotBrain.js";
import type { PlayerId } from "@ddz/domain";

/** 客户端建房时所选的机器人决策(不可信,resolveDecisionConfig 校验后才生效)。 */
export interface BotDecisionOptions {
  readonly botDecisionMode?: string | undefined;
  readonly botProvider?: string | undefined;
  readonly botModel?: string | undefined;
  readonly botReasoningEffort?: string | undefined;
}

/** LLM bot 的可观测钩子(可选);仅 LLM bot 用,规则 bot 忽略。 */
export interface BotBrainHooks {
  readonly onTrace?: (trace: LlmDecisionTrace) => void;
  readonly onDecision?: (metric: LlmDecisionMetric) => void;
  /** 出牌决策中模型输出增量(playerId + channel + 片段),供牌桌「AI 输出流」实时广播;与 onTrace 落盘正交。 */
  readonly onStreamDelta?: (playerId: PlayerId, delta: MoveStreamDelta) => void;
  /** 出牌决策成功后模型编号对应的具体候选动作,供牌桌把原始数字显示成可理解结果。 */
  readonly onChoice?: (playerId: PlayerId, choice: LlmDecisionChoice) => void;
}

/** 校验后的决策配置:model 保证落在注册表内(命中客户端所选,否则回退 registry.default)。 */
export interface ResolvedDecision {
  readonly useLlm: boolean;
  readonly model: ModelRef;
  readonly timeoutMs: number;
  readonly reasoningEffort: ReasoningEffort;
}

/**
 * 建房 options(客户端所选,经校验)覆盖 BOT_DECISION env 默认,产出最终决策配置。
 * mode 非法 → 回 env 默认;provider/model 不在注册表 → 回 registry.default。纯函数,导出供单测。
 */
export function resolveDecisionConfig(
  options: BotDecisionOptions,
  registry: BotProviderRegistry,
  envConfig: DecisionConfig = decisionConfigFromEnv()
): ResolvedDecision {
  const mode =
    options.botDecisionMode === "llm" || options.botDecisionMode === "rule" ? options.botDecisionMode : undefined;
  const useLlm = mode ? mode === "llm" : envConfig.useLlm;
  const requested: ModelRef | null =
    options.botProvider && options.botModel ? { provider: options.botProvider, model: options.botModel } : null;
  const model = requested && isAllowedModel(registry, requested) ? requested : registry.default;
  // 客户端档位(不可信)校验后覆盖 env 默认;非法/缺省回退 env 默认(与上面 mode 同款「非法回退」)。
  const reasoningEffort =
    options.botReasoningEffort === undefined
      ? envConfig.reasoningEffort
      : parseReasoningEffort(options.botReasoningEffort);
  return { useLlm, model, timeoutMs: envConfig.timeoutMs, reasoningEffort };
}

/**
 * 由决策配置造大脑:规则 bot 同步;LLM bot 在缺配置时**直接抛错**(不静默回退)。
 * 配置缺失是确定性错误,应在建房时显式失败,让用户知道要去配置,而不是假装在跑 AI。
 */
export function createBotBrain(
  config: ResolvedDecision,
  registry: BotProviderRegistry,
  hooks?: BotBrainHooks
): BotBrain {
  if (!config.useLlm) {
    return new RuleBotBrain();
  }
  const model = resolveModel(config.model, registry, { reasoningEffort: config.reasoningEffort });
  if (!model) {
    const { provider, model: name } = config.model;
    throw new Error(
      `AI 对战需要为 ${provider}/${name} 配置 API key(openai-compatible 还需 base_url),当前未配置——已拒绝建房。` +
        `请在 bot-providers.json / BOT_PROVIDERS 环境变量(或 anthropic 的 ANTHROPIC_API_KEY)中配置后重试。`
    );
  }
  // resolveModel 非 null 已保证 provider 存在;据其类型把思考强度档位翻成对应 provider 的 providerOptions。
  const providerType = registry.providers[config.model.provider]!.type;
  const providerOptions = buildReasoningProviderOptions(providerType, config.model.provider, config.reasoningEffort);
  return new LlmBotBrain({
    chooser: new LlmMoveChooser({ model, timeoutMs: config.timeoutMs, providerOptions }),
    onTrace: hooks?.onTrace,
    onDecision: hooks?.onDecision,
    onStreamDelta: hooks?.onStreamDelta,
    onChoice: hooks?.onChoice
  });
}

export function resolveBotBrain(
  options: BotDecisionOptions,
  registry: BotProviderRegistry,
  hooks?: BotBrainHooks,
  envConfig?: DecisionConfig
): BotBrain {
  return createBotBrain(resolveDecisionConfig(options, registry, envConfig), registry, hooks);
}
