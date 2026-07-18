import {
  LlmChoiceRunner,
  type LlmChoiceRunnerOptions,
  type MoveDecision,
  type MoveStreamHooks
} from "./choiceRunner.js";
import { formatRecentAction, type RecentActionInfo } from "./moveChooser.js";

/**
 * 叫/抢地主所需的公开局势(由调用方从快照映射)。与出牌的 MoveSelectionContext 刻意分开:
 * 叫抢阶段身份未定、没有上一手/候选走法,prompt 要讲的是「当不当地主」的风险收益,硬塞出牌语境会毁 prompt 质量。
 * 同样只给公开事实(自己手牌 + 桌面叫抢过程),不灌输策略。
 */
export interface BiddingContext {
  readonly kind: "bidding" | "robbing";
  /** 自己的完整手牌(按从小到大分组的中文描述)。 */
  readonly hand: readonly string[];
  /** 本副牌已发生的叫/抢动作(公开信息),按时间顺序。 */
  readonly bidHistory: readonly RecentActionInfo[];
  /** 当前倍数(每次抢地主 ×2)。 */
  readonly currentMultiplier: number;
  /** 是否首叫者的唯一一次反抢机会(此时再抢则地主直接归自己且倍数再 ×2)。 */
  readonly isCounterRob: boolean;
  /** 固定两项:["不叫","叫地主"] 或 ["不抢","抢地主"]。 */
  readonly candidates: readonly string[];
}

/** 叫/抢决策器:语义同 MoveChooser——返回 null 表示没发请求,错误进 trace 由调用方抛错暴露。 */
export interface BidChooser {
  choose(ctx: BiddingContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null>;
}

export type LlmBidChooserOptions = LlmChoiceRunnerOptions;

/** 叫抢选择器薄壳:组装叫抢 system/prompt,请求管线与编号解析在 LlmChoiceRunner。 */
export class LlmBidChooser implements BidChooser {
  private readonly runner: LlmChoiceRunner;

  constructor(options: LlmBidChooserOptions) {
    this.runner = new LlmChoiceRunner(options);
  }

  async choose(ctx: BiddingContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null> {
    return this.runner.run(
      {
        system: buildBiddingSystem(),
        prompt: formatBiddingPrompt(ctx),
        candidateCount: ctx.candidates.length,
        candidateLabels: ctx.candidates
      },
      streamHooks
    );
  }
}

export function buildBiddingSystem(): string {
  const lines = [
    `你是斗地主高手,现在处于叫地主/抢地主阶段。`,
    `规则:一局三人,地主 1 人 对 农民 2 人。当上地主可获得 3 张公开底牌并入手牌、且先出牌,但要以一敌二;输赢分数按倍数结算,地主赢拿双份、输赔双份。`,
    `流程:先轮流叫地主;有人叫后其余两人可依次抢地主,每被抢一次倍数 ×2;若地主位被抢走,首叫者还有唯一一次反抢机会。全员不叫则重新发牌。`,
    `请依据手牌强弱(大牌、炸弹、牌型顺畅度)权衡当地主的收益与风险,再做决定。`,
    `所有可见文字都必须使用简体中文;如模型支持独立思考通道,思考通道也必须使用简体中文简短分析。`,
    `快速判断后立刻给答案。最终回复只输出你选择的那个选项的编号数字(例如 1),不要解释、不要任何其它文字或标点。`
  ];
  return lines.join("");
}

export function formatBiddingPrompt(ctx: BiddingContext): string {
  const options = ctx.candidates.map((label, index) => `${index + 1}: ${label}`).join("\n");
  const lines = [`你的手牌:${ctx.hand.join(" ")}`];
  if (ctx.bidHistory.length > 0) {
    lines.push(`叫抢过程:\n${ctx.bidHistory.map((action, index) => `${index + 1}. ${formatRecentAction(action)}`).join("\n")}`);
  }
  lines.push(`当前倍数:${ctx.currentMultiplier}。`);
  if (ctx.kind === "bidding") {
    lines.push(`现在轮到你叫地主:叫了之后其余两人仍可抢(每抢一次倍数 ×2);不叫则轮给下家,全员不叫会重新发牌。`);
  } else if (ctx.isCounterRob) {
    lines.push(`地主位被别人抢走,你作为首叫者有唯一一次反抢机会:反抢则地主直接归你且倍数再 ×2;放弃则地主归当前抢到的人。`);
  } else {
    lines.push(`现在轮到你抢地主:抢则你成为地主候选且倍数 ×2(首叫者可能反抢);不抢则维持现状。`);
  }
  lines.push(
    `可选决定(编号: 描述):`,
    options,
    `请做出决定。如有独立思考通道,先用简体中文简短分析;最终只输出一个编号数字(1 到 ${ctx.candidates.length}),不要任何其它文字。`
  );
  return lines.join("\n");
}
