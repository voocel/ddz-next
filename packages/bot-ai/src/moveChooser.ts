import {
  LlmChoiceRunner,
  type LlmChoiceRunnerOptions,
  type MoveDecision,
  type MoveStreamHooks
} from "./choiceRunner.js";

/** 其他一家:相对自己的身份(地主/队友/农民)+ 剩牌数 + 当前公开可见的手牌。 */
export interface OpponentInfo {
  readonly label: string;
  readonly handCount: number;
  /**
   * 对该 AI 当前公开可见的对手手牌(按从小到大分组的中文描述)。
   * 普通暗牌局为空;以后支持明牌/局部公开时直接填这里。
   */
  readonly revealedCards: readonly string[];
}

/** 上一手:由谁(按角色)打出的什么牌型。 */
export interface LastPlayInfo {
  /** 打出者相对自己的身份,如「地主」「队友」「农民」。 */
  readonly by: string;
  /** 牌型描述,如「对子7」。 */
  readonly description: string;
}

export interface RecentActionInfo {
  /** 行动者相对自己的身份,如「你」「地主」「队友」「农民」。 */
  readonly by: string;
  readonly action: "play" | "pass" | "bid" | "rob";
  /** action=play 时的牌型/牌点简述;bid/rob 时为「叫地主/不叫」「抢地主/不抢」;pass 时省略。 */
  readonly description?: string;
}

export interface TurnOrderInfo {
  readonly label: string;
  readonly handCount: number;
}

/**
 * 选牌所需的公开局势 + 候选走法(由调用方从快照映射,bot-ai 不依赖游戏内部类型)。
 * 刻意给足农民/地主决策所需的公开事实:自己的完整手牌、本局已出的牌、各家身份+剩牌+明牌、上一手由谁打出——
 * 但不灌输策略(出什么由模型自己定),以如实验证模型牌力。
 * candidates 是中文走法标签;对模型展示为 1..N 编号,内部仍按数组 0 基索引返回。
 * 过牌等特殊选项也由调用方放进列表。
 */
export interface MoveSelectionContext {
  readonly role: "landlord" | "farmer";
  /** 自己的完整手牌(按从小到大分组的中文描述,如 ["3","5×2","J","2×2"]),供模型规划。 */
  readonly hand: readonly string[];
  /** 地主底牌(公开后按从小到大分组);叫抢阶段不会调用 LLM 出牌,正常出牌时已公开。 */
  readonly landlordCards?: readonly string[];
  /**
   * 本局已出的牌(按从小到大分组的中文,如 ["3×2","K","大王"])。公开信息、桌上人人可见,
   * 给模型用于记牌、推断各点数还剩多少未现——这是事实而非策略。开局领出、本局尚无人出牌时为空数组。
   */
  readonly playedCards: readonly string[];
  /** 当前公开信息下尚未出现的牌(不含自己手牌、已出牌、地主底牌),帮助模型稳定记牌。 */
  readonly unseenCards?: readonly string[];
  /** 从自己开始的出牌顺序与剩牌数。 */
  readonly turnOrder?: readonly TurnOrderInfo[];
  /** 其他两家,按座位顺序;含身份标签/剩牌/公开可见手牌,农民据此分辨地主与队友。 */
  readonly opponents: readonly OpponentInfo[];
  /** 上一手由谁打出的什么;轮到领出时为 null。 */
  readonly lastPlay: LastPlayInfo | null;
  /** 最近公开动作,有界保留,用于理解谁连续出牌/谁过牌/自己刚做过什么。 */
  readonly recentActions?: readonly RecentActionInfo[];
  /** 候选走法标签,至少一项;模型只能在提示词展示的 1..N 编号中选一项。 */
  readonly candidates: readonly string[];
}

/**
 * LLM 选牌器:在调用方给出的合法候选里选一个索引。
 * 返回 null 仅表示「没发请求」(model 为 null / 无候选);否则返回带完整 trace 的 MoveDecision。
 * API/网络/超时错误被捕获进 trace.error(不抛),由调用方据此抛错暴露——既留证又不静默。
 * streamHooks 可选:传入时在决策过程中实时回调模型 reasoning/text 增量(用于牌桌「AI 输出流」展示)。
 */
export interface MoveChooser {
  choose(ctx: MoveSelectionContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null>;
}

export type LlmMoveChooserOptions = LlmChoiceRunnerOptions;

/** 出牌选择器薄壳:组装出牌 system/prompt,请求管线与编号解析在 LlmChoiceRunner。 */
export class LlmMoveChooser implements MoveChooser {
  private readonly runner: LlmChoiceRunner;

  constructor(options: LlmMoveChooserOptions) {
    this.runner = new LlmChoiceRunner(options);
  }

  async choose(ctx: MoveSelectionContext, streamHooks?: MoveStreamHooks): Promise<MoveDecision | null> {
    return this.runner.run(
      {
        system: buildSystem(ctx.role),
        prompt: formatMoveSelectionPrompt(ctx),
        candidateCount: ctx.candidates.length,
        candidateLabels: ctx.candidates
      },
      streamHooks
    );
  }
}

function buildSystem(role: "landlord" | "farmer"): string {
  const roleLabel = role === "landlord" ? "地主" : "农民";
  const lines = [
    `你是斗地主高手,当前是${roleLabel}。`,
    `一局三人:地主 1 人 对 农民 2 人;两个农民是一队、目标一致,要合力让地主出不完牌。`,
    `你会看到自己的完整手牌、各家身份/剩牌/公开明牌、上一手由谁打出,以及若干从 1 开始编号的合法出牌选项,只能从中选一个。`,
    `目标:打赢这一局——地主要尽快出完牌,农民要和队友配合拦截地主。`,
    role === "farmer"
      ? `农民策略倾向:跟地主牌时不要因牌小就默认过牌;若用低代价小牌可阻断地主连续清牌,要认真考虑接管牌权。若必须消耗2、王、炸弹或严重拆坏关键牌型,可以过牌。跟队友牌时通常不抢队友牌权,除非接手后收益明显更高。`
      : `地主策略倾向:优先减少手牌和保持出牌权;小牌可用于清理牌型,但要警惕农民用低代价接管牌权。`,
    `所有可见文字都必须使用简体中文;如模型支持独立思考通道,思考通道也必须使用简体中文简短分析。`,
    `快速判断后立刻给答案。最终回复只输出你选择的那个选项的编号数字(例如 2),不要复述牌型、不要解释、不要任何其它文字或标点。`
  ];
  return lines.join("");
}

export function formatMoveSelectionPrompt(ctx: MoveSelectionContext): string {
  const opponents = ctx.opponents.map(formatOpponentInfo).join(",");
  const options = ctx.candidates.map((label, index) => `${index + 1}: ${label}`).join("\n");
  // 手牌/已出都用分组计数(×N)如实呈现张数,不再额外报一个会和列表对不上的总数。
  const lines = [`你的手牌:${ctx.hand.join(" ")}`];
  if (ctx.turnOrder && ctx.turnOrder.length > 0) {
    lines.push(`出牌顺序:${ctx.turnOrder.map((item) => `${item.label}(${item.handCount}张)`).join(" -> ")}。`);
  }
  if (ctx.landlordCards && ctx.landlordCards.length > 0) {
    lines.push(`地主底牌:${ctx.landlordCards.join(" ")}。`);
  }
  // 本局已出是公开信息(桌上人人可见),供模型记牌、推断剩余;开局无人出牌时不赘述。
  if (ctx.playedCards.length > 0) {
    lines.push(`本局已出:${ctx.playedCards.join(" ")}。`);
  }
  if (ctx.unseenCards && ctx.unseenCards.length > 0) {
    lines.push(`未见牌:${ctx.unseenCards.join(" ")}。`);
  }
  if (ctx.recentActions && ctx.recentActions.length > 0) {
    lines.push(`最近动作:\n${ctx.recentActions.map((action, index) => `${index + 1}. ${formatRecentAction(action)}`).join("\n")}`);
  }
  const focus = decisionFocus(ctx);
  lines.push(
    `其他两家:${opponents}。`,
    ctx.lastPlay
      ? `上一手:${ctx.lastPlay.by}打出 ${ctx.lastPlay.description},现在轮到你跟牌(压得过可压、也可过牌)。`
      : `现在轮到你领出,可任意出牌。`,
    ...(focus ? [`本手重点:${focus}`] : []),
    `可选出牌(编号: 描述):`,
    options,
    `请选择最优的一手。如有独立思考通道,先用简体中文简短分析;最终只输出一个编号数字(1 到 ${ctx.candidates.length}),不要任何其它文字。`
  );
  return lines.join("\n");
}

function decisionFocus(ctx: MoveSelectionContext): string | null {
  if (!ctx.lastPlay) {
    return "你在领出。请优先比较一次能走掉多少张、剩余牌型是否顺畅、以及是否需要保留关键控制牌。";
  }
  if (ctx.role === "farmer" && ctx.lastPlay.by === "地主") {
    return "上一手来自地主。过牌会增加地主连续清牌和保持牌权的机会;请比较最小可压代价与放地主继续出牌的风险,不要只因为牌小就默认过。";
  }
  if (ctx.role === "farmer" && ctx.lastPlay.by === "队友") {
    return "上一手来自队友。农民之间以配合为先,通常不要无意义抢队友牌权;只有接手后能明显压制地主或更快走牌时再压。";
  }
  if (ctx.role === "landlord") {
    return "你在跟农民牌。请比较抢回牌权的收益、消耗控制牌的代价、以及过牌后农民继续配合走牌的风险。";
  }
  return null;
}

function formatOpponentInfo(opponent: OpponentInfo): string {
  const revealed =
    opponent.revealedCards.length > 0 ? `,明牌:${opponent.revealedCards.join(" ")}` : "";
  return `${opponent.label}剩 ${opponent.handCount} 张${revealed}`;
}

/** 渲染一条公开动作(出牌/过牌/叫抢),供出牌与叫抢两条 prompt 复用。 */
export function formatRecentAction(action: RecentActionInfo): string {
  switch (action.action) {
    case "pass":
      return `${action.by}: 不要`;
    case "bid":
    case "rob":
      return `${action.by}: ${action.description ?? ""}`;
    default:
      return `${action.by}: ${action.description ?? "出牌"}`;
  }
}
