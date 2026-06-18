import type { Combination, Rank } from "@ddz/domain";

// 牌型 → 中文标签,供机器人解说与 LLM 候选描述复用;未知牌型兜底为「一手牌」。
const COMBINATION_LABELS: Record<string, string> = {
  single: "单张",
  pair: "对子",
  trio: "三条",
  trio_with_single: "三带一",
  trio_with_pair: "三带二",
  straight: "顺子",
  pair_sequence: "连对",
  plane: "飞机",
  plane_with_singles: "飞机带单",
  plane_with_pairs: "飞机带对",
  four_with_two_singles: "四带二",
  four_with_two_pairs: "四带两对",
  bomb: "炸弹",
  rocket: "王炸"
};

const RANK_LABELS: Partial<Record<Rank, string>> = {
  SJ: "小王",
  BJ: "大王"
};

export function combinationLabel(kind: string): string {
  return COMBINATION_LABELS[kind] ?? "一手牌";
}

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank] ?? rank;
}

/** 把一手牌描述成简短中文,如「对子K」「顺子至A」「炸弹3」,供 LLM 候选列表/上家描述使用。 */
export function describeCombination(combination: Combination): string {
  const kind = combinationLabel(combination.kind);
  if (combination.kind === "rocket") {
    return kind;
  }
  const main = rankLabel(combination.mainRank);
  if (combination.chainLength && combination.chainLength > 0) {
    return `${kind}至${main}(${combination.cards.length}张)`;
  }
  return `${kind}${main}`;
}
