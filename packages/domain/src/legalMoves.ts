import type { Card, Rank } from "./cards.js";
import { getRankValue, RANKS, sortCards } from "./cards.js";
import type { Combination, CombinationKind } from "./combinations.js";
import { canBeat, COMBINATION_KINDS, identifyCombination } from "./combinations.js";

/**
 * 一手合法走法:具体牌(可直接出)+ 已识别的牌型。
 * 与 suggestPlay(只求最小压制)、decideBotPlay(规则启发式选一手)不同,
 * enumerateLegalMoves 给出**规范化的全部合法选项**,用于约束 LLM 决策的选择空间:
 * 服务端只把这些选项喂给模型,模型只能在其中选,天然杜绝非法出牌。
 */
export interface LegalMove {
  readonly cards: readonly Card[];
  readonly combination: Combination;
}

// 顺子/连对/飞机只在 3..A 之间;2 和大小王不参与连牌。
const CHAIN_RANKS = RANKS.filter((rank) => getRankValue(rank) <= getRankValue("A"));
const KIND_ORDER = new Map<CombinationKind, number>(COMBINATION_KINDS.map((kind, index) => [kind, index]));

interface RankGroup {
  readonly rank: Rank;
  /** 该点数全部手牌,升序。 */
  readonly cards: readonly Card[];
  readonly count: number;
  readonly value: number;
}

/**
 * 枚举当前手牌的全部合法走法。
 * - previous 为 null(领出):返回手牌能组成的所有规范牌型。
 * - previous 非 null(跟牌):仅返回能压过 previous 的走法(含炸弹/火箭)。
 * 「规范化」指:同一(牌型, 主点, 连长)只给一个代表,带牌自动选最廉价的(最低、最不破坏结构),
 * 把策略选择(出什么型、压到哪一点)交给上层,而不淹没在带牌排列里。
 */
export function enumerateLegalMoves(hand: readonly Card[], previous: Combination | null): readonly LegalMove[] {
  const all = enumerateAllPlays(hand);
  const legal = previous ? all.filter((move) => canBeat(move.combination, previous)) : all;
  return legal.slice().sort(compareMoves);
}

function compareMoves(a: LegalMove, b: LegalMove): number {
  return (
    (KIND_ORDER.get(a.combination.kind) ?? 0) - (KIND_ORDER.get(b.combination.kind) ?? 0) ||
    getRankValue(a.combination.mainRank) - getRankValue(b.combination.mainRank) ||
    a.cards.length - b.cards.length
  );
}

function enumerateAllPlays(hand: readonly Card[]): LegalMove[] {
  if (hand.length === 0) {
    return [];
  }

  const groups = buildGroups(hand);
  const cardSets: Card[][] = [];

  collectRepeated(groups, cardSets);
  collectTrioWings(groups, cardSets);
  collectQuadWings(groups, cardSets);
  collectRocket(groups, cardSets);
  collectChains(groups, cardSets);
  collectPlaneWings(groups, cardSets);

  const moves: LegalMove[] = [];
  for (const cards of cardSets) {
    const combination = identifyCombination(cards);
    if (combination) {
      moves.push({ cards: sortCards(cards, "asc"), combination });
    }
  }
  return dedupe(moves);
}

// 单张 / 对子 / 三条 / 炸弹:每个点数取所需张数。
function collectRepeated(groups: readonly RankGroup[], out: Card[][]): void {
  for (const group of groups) {
    for (const count of [1, 2, 3, 4] as const) {
      if (group.count >= count) {
        out.push(group.cards.slice(0, count));
      }
    }
  }
}

// 三带一 / 三带二:三条 + 最廉价的单/对(来自其它点数)。
function collectTrioWings(groups: readonly RankGroup[], out: Card[][]): void {
  for (const trio of groups.filter((group) => group.count >= 3)) {
    const exclude = new Set<Rank>([trio.rank]);
    const single = pickLowestSingles(groups, 1, exclude);
    if (single) {
      out.push([...trio.cards.slice(0, 3), ...single]);
    }
    const pair = pickLowestPairs(groups, 1, exclude);
    if (pair) {
      out.push([...trio.cards.slice(0, 3), ...pair]);
    }
  }
}

// 四带二单 / 四带两对:炸弹 + 两个最廉价的单/对。
function collectQuadWings(groups: readonly RankGroup[], out: Card[][]): void {
  for (const quad of groups.filter((group) => group.count === 4)) {
    const exclude = new Set<Rank>([quad.rank]);
    const singles = pickLowestSingles(groups, 2, exclude);
    if (singles) {
      out.push([...quad.cards.slice(0, 4), ...singles]);
    }
    const pairs = pickLowestPairs(groups, 2, exclude);
    if (pairs) {
      out.push([...quad.cards.slice(0, 4), ...pairs]);
    }
  }
}

function collectRocket(groups: readonly RankGroup[], out: Card[][]): void {
  const small = groups.find((group) => group.rank === "SJ")?.cards[0];
  const big = groups.find((group) => group.rank === "BJ")?.cards[0];
  if (small && big) {
    out.push([small, big]);
  }
}

// 顺子(单连) / 连对(对连) / 飞机不带(三连):在 CHAIN_RANKS 上找所有连续段。
function collectChains(groups: readonly RankGroup[], out: Card[][]): void {
  appendSequences(groups, 1, 5, out); // 顺子 >=5
  appendSequences(groups, 2, 3, out); // 连对 >=3 对
  appendSequences(groups, 3, 2, out); // 飞机 >=2 个三条
}

// 飞机带单 / 飞机带对:每段飞机 + 与三条数等量的最廉价单/对。
function collectPlaneWings(groups: readonly RankGroup[], out: Card[][]): void {
  for (const run of consecutiveRuns(groups, 3, 2)) {
    const exclude = new Set<Rank>(run.map((group) => group.rank));
    const base = run.flatMap((group) => group.cards.slice(0, 3));
    const singles = pickLowestSingles(groups, run.length, exclude);
    if (singles) {
      out.push([...base, ...singles]);
    }
    const pairs = pickLowestPairs(groups, run.length, exclude);
    if (pairs) {
      out.push([...base, ...pairs]);
    }
  }
}

function appendSequences(groups: readonly RankGroup[], countPerRank: number, minLen: number, out: Card[][]): void {
  for (const run of consecutiveRuns(groups, countPerRank, minLen)) {
    out.push(run.flatMap((group) => group.cards.slice(0, countPerRank)));
  }
}

// 在 CHAIN_RANKS 上枚举所有长度 >= minLen、每位张数 >= countPerRank 的连续段(各长度、各起点)。
function consecutiveRuns(groups: readonly RankGroup[], countPerRank: number, minLen: number): RankGroup[][] {
  const byRank = new Map(groups.map((group) => [group.rank, group]));
  const usable = CHAIN_RANKS.map((rank) => byRank.get(rank)).map((group) =>
    group && group.count >= countPerRank ? group : null
  );

  const runs: RankGroup[][] = [];
  for (let start = 0; start < usable.length; start += 1) {
    const window: RankGroup[] = [];
    for (let i = start; i < usable.length; i += 1) {
      const group = usable[i];
      if (!group) {
        break;
      }
      window.push(group);
      if (window.length >= minLen) {
        runs.push([...window]);
      }
    }
  }
  return runs;
}

// 选 count 张最廉价的单牌作翼:优先真单张(不破坏对子/三条),再按点数升序;避免拆散火箭。
function pickLowestSingles(groups: readonly RankGroup[], count: number, exclude: ReadonlySet<Rank>): Card[] | null {
  const pool = groups
    .filter((group) => !exclude.has(group.rank))
    .slice()
    .sort((a, b) => wingCost(a.count, 1) - wingCost(b.count, 1) || a.value - b.value);

  const chosen = pool.slice(0, count);
  if (chosen.length < count) {
    return null;
  }
  // 双王不能同时作翼(等于拆火箭),用下一个非王候选替换大王。
  if (chosen.some((group) => group.rank === "SJ") && chosen.some((group) => group.rank === "BJ")) {
    const replacement = pool.slice(count).find((group) => group.rank !== "SJ" && group.rank !== "BJ");
    if (!replacement) {
      return null;
    }
    chosen[chosen.findIndex((group) => group.rank === "BJ")] = replacement;
  }
  return chosen.map((group) => group.cards[0]!);
}

// 选 count 个最廉价的对子作翼:优先真对子(不破坏三条/炸弹),再按点数升序。
function pickLowestPairs(groups: readonly RankGroup[], count: number, exclude: ReadonlySet<Rank>): Card[] | null {
  const pool = groups
    .filter((group) => group.count >= 2 && !exclude.has(group.rank))
    .slice()
    .sort((a, b) => wingCost(a.count, 2) - wingCost(b.count, 2) || a.value - b.value);

  if (pool.length < count) {
    return null;
  }
  return pool.slice(0, count).flatMap((group) => group.cards.slice(0, 2));
}

// 用该点数当翼的代价:恰好够用 0(真单/对),拆散非炸弹 1,拆炸弹 2。越小越优先选。
function wingCost(groupCount: number, need: number): number {
  if (groupCount === need) {
    return 0;
  }
  return groupCount < 4 ? 1 : 2;
}

function buildGroups(hand: readonly Card[]): RankGroup[] {
  const byRank = new Map<Rank, Card[]>();
  for (const card of sortCards(hand, "asc")) {
    const group = byRank.get(card.rank) ?? [];
    group.push(card);
    byRank.set(card.rank, group);
  }
  return [...byRank.entries()]
    .map(([rank, cards]) => ({ rank, cards, count: cards.length, value: getRankValue(rank) }))
    .sort((a, b) => a.value - b.value);
}

function dedupe(moves: readonly LegalMove[]): LegalMove[] {
  const seen = new Set<string>();
  const result: LegalMove[] = [];
  for (const move of moves) {
    const key = move.cards.map((card) => card.id).join(",");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(move);
    }
  }
  return result;
}
