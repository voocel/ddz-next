import type { Card, CardId, Rank } from "./cards.js";
import { createDeck, getRankValue, RANKS, sortCards } from "./cards.js";
import type { Combination } from "./combinations.js";
import { identifyCombination } from "./combinations.js";
import type { PlayerId } from "./game.js";
import { suggestPlay } from "./suggestions.js";

/**
 * 机器人出牌大脑。与"提示按钮"使用的 suggestPlay 分离:
 * suggestPlay 只求最小合法压制,这里在其之上加入手牌规划与角色配合。
 * 纯函数、无副作用,信息全部来自快照,便于测试与将来替换实现。
 */
export interface BotPlayView {
  readonly hand: readonly Card[];
  readonly previous: Combination | null;
  /** 上一手是谁出的;用于判断该不该压(队友 vs 对手)。 */
  readonly previousBy: PlayerId | null;
  readonly selfId: PlayerId;
  readonly landlordId: PlayerId;
  readonly players: readonly { readonly id: PlayerId; readonly handCount: number }[];
  /** 本局已打出的所有牌,用于记牌判断"绝对大牌";缺省视为无记忆。 */
  readonly playedCards: readonly Card[];
}

// 顺子/连对/飞机只在 3..A 之间;2 和大小王不参与连牌,天然成为控制牌。
const CHAIN_RANKS = RANKS.filter((rank) => getRankValue(rank) <= getRankValue("A"));
const CONTROL_RANKS: ReadonlySet<Rank> = new Set<Rank>(["2", "SJ", "BJ"]);
// 对手手数 <= 此值视为即将走完,值得动用炸弹/火箭拦截。
const ABOUT_TO_WIN = 2;
// 对手手数 <= 此值时不再藏大牌:大牌单/对没炸弹珍贵,该抢就抢,免得放对手轻松走完。
const CONTEST_LEAD = 4;
// 自己手数 <= 此值时进入残局,不再保留大牌,优先抢动走完。
const HOARD_MIN_HAND = 5;
// 单/对/三条被同型压制所需的最少同点张数,用于记牌判断大牌。
const SAME_KIND_COUNT: Partial<Record<Combination["kind"], number>> = {
  single: 1,
  pair: 2,
  trio: 3
};

export function decideBotPlay(view: BotPlayView): readonly Card[] | null {
  if (view.hand.length === 0) {
    return null;
  }
  return view.previous ? planFollow(view) : planLead(view.hand);
}

// 领出:基于手牌分解,优先甩掉价值最低的可弃组合,保留控制牌做后手。
function planLead(hand: readonly Card[]): readonly Card[] {
  const combos = decomposeHand(hand);
  if (combos.length === 0) {
    return sortCards(hand, "asc").slice(0, 1);
  }

  const disposable = combos.filter((combo) => !isControlCombo(combo));
  const pool = disposable.length > 0 ? disposable : combos;
  const choice = pool.reduce((best, combo) =>
    getRankValue(combo.mainRank) < getRankValue(best.mainRank) ? combo : best
  );
  return sortCards(choice.cards, "asc");
}

// 跟牌:不压自己人;压对手时复用 suggestPlay 求最小压制,但不为小牌浪费炸弹。
function planFollow(view: BotPlayView): readonly Card[] | null {
  // 永不去压自己或队友打出的牌(自压在当前调用链不可达,作契约防御)。
  if (view.previousBy === view.selfId || isTeammatePlay(view)) {
    return null;
  }

  const beat = suggestPlay(view.hand, view.previous);
  if (!beat) {
    return null;
  }

  const combo = identifyCombination(beat);
  const usesBomb = combo?.kind === "bomb" || combo?.kind === "rocket";
  const previousBombish = view.previous?.kind === "bomb" || view.previous?.kind === "rocket";
  if (usesBomb && !previousBombish && !opponentAboutToWin(view)) {
    return null;
  }

  // 记牌:若压制只能动用当前"绝对大牌"且局面不紧迫,留着不浪费在小牌上。
  if (combo && shouldHoldControlCard(view, combo, beat.length)) {
    return null;
  }
  return beat;
}

function shouldHoldControlCard(view: BotPlayView, beat: Combination, beatSize: number): boolean {
  if (beat.kind === "bomb" || beat.kind === "rocket") {
    return false; // 炸弹/火箭已有专门规则
  }
  if (beatSize === view.hand.length || view.hand.length <= HOARD_MIN_HAND) {
    return false; // 这一手能走完、或自己已进入残局,优先抢动
  }
  if (minOpponentHandCount(view) <= CONTEST_LEAD) {
    return false; // 对手快走完,大牌也要抢着压
  }
  return dominates(beat, unseenCards(view));
}

function isControlCombo(combo: Combination): boolean {
  return combo.kind === "bomb" || combo.kind === "rocket" || CONTROL_RANKS.has(combo.mainRank);
}

function isTeammatePlay(view: BotPlayView): boolean {
  const amFarmer = view.selfId !== view.landlordId;
  return (
    amFarmer &&
    view.previousBy !== null &&
    view.previousBy !== view.selfId &&
    view.previousBy !== view.landlordId
  );
}

function opponentAboutToWin(view: BotPlayView): boolean {
  return minOpponentHandCount(view) <= ABOUT_TO_WIN;
}

function minOpponentHandCount(view: BotPlayView): number {
  let min = Number.POSITIVE_INFINITY;
  for (const player of view.players) {
    if (isOpponent(view, player.id) && player.handCount > 0) {
      min = Math.min(min, player.handCount);
    }
  }
  return min;
}

function isOpponent(view: BotPlayView, playerId: PlayerId): boolean {
  if (playerId === view.selfId) {
    return false;
  }
  // 我是地主时两个农民都是对手;我是农民时只有地主是对手。
  return view.selfId === view.landlordId || playerId === view.landlordId;
}

// 忽略炸弹/火箭的前提下,该组合是否已是同型中无人能压的"绝对大牌"。
function dominates(combo: Combination, unseen: readonly Card[]): boolean {
  const need = SAME_KIND_COUNT[combo.kind];
  if (need === undefined) {
    return false; // 复杂牌型不评估,保守按"可被压"处理
  }

  const mainValue = getRankValue(combo.mainRank);
  const higherCounts = new Map<number, number>();
  for (const card of unseen) {
    const value = getRankValue(card.rank);
    if (value > mainValue) {
      higherCounts.set(value, (higherCounts.get(value) ?? 0) + 1);
    }
  }
  for (const count of higherCounts.values()) {
    if (count >= need) {
      return false; // 存在更高且足量的同型未见牌,能被压
    }
  }
  return true;
}

// 推断对手手中可能的牌:整副牌去掉自己手牌与本局已出的牌。
function unseenCards(view: BotPlayView): Card[] {
  const seen = new Set<CardId>();
  for (const card of view.hand) {
    seen.add(card.id);
  }
  for (const card of view.playedCards) {
    seen.add(card.id);
  }
  return createDeck().filter((card) => !seen.has(card.id));
}

/**
 * 把手牌贪心分解成一组组合(每张牌恰好属于一个组合)。
 * 按密度递减抽取:火箭→炸弹→飞机→连对→顺子→剩余三条/对子/单张,
 * 让更紧密的结构优先成形(如连对不被顺子拆散)。
 * 这是简单启发式而非最优搜索,够日常机器人使用,也可复用于牌力评估。
 */
export function decomposeHand(hand: readonly Card[]): Combination[] {
  const remaining = groupRemaining(hand);
  const cardGroups: Card[][] = [];

  const rocket = takeRocket(remaining);
  if (rocket) {
    cardGroups.push(rocket);
  }
  cardGroups.push(...takeBombs(remaining));
  cardGroups.push(...extractChains(remaining, 3, 2, 3)); // 飞机:连续三条
  cardGroups.push(...extractChains(remaining, 2, 3, 2)); // 连对:连续对子
  cardGroups.push(...extractChains(remaining, 1, 5, 1)); // 顺子:连续单张
  cardGroups.push(...takeLeftovers(remaining)); // 剩余的三条/对子/单张

  return cardGroups
    .map((cards) => identifyCombination(cards))
    .filter((combo): combo is Combination => combo !== null);
}

function groupRemaining(hand: readonly Card[]): Map<Rank, Card[]> {
  const remaining = new Map<Rank, Card[]>();
  for (const card of sortCards(hand, "asc")) {
    const group = remaining.get(card.rank) ?? [];
    group.push(card);
    remaining.set(card.rank, group);
  }
  return remaining;
}

function takeRocket(remaining: Map<Rank, Card[]>): Card[] | null {
  const smallJoker = remaining.get("SJ");
  const bigJoker = remaining.get("BJ");
  if (smallJoker?.length && bigJoker?.length) {
    return [...smallJoker.splice(0, 1), ...bigJoker.splice(0, 1)];
  }
  return null;
}

function takeBombs(remaining: Map<Rank, Card[]>): Card[][] {
  const bombs: Card[][] = [];
  for (const rank of RANKS) {
    const group = remaining.get(rank);
    if (group && group.length === 4) {
      bombs.push(group.splice(0, 4));
    }
  }
  return bombs;
}

// 在 CHAIN_RANKS 上反复抽取"连续且每位张数 >= need、长度 >= minLen"的最长连牌,每位取 take 张。
function extractChains(remaining: Map<Rank, Card[]>, need: number, minLen: number, take: number): Card[][] {
  const results: Card[][] = [];
  let extracted = true;
  while (extracted) {
    extracted = false;
    let run: Rank[] = [];
    const flush = (): void => {
      if (run.length >= minLen) {
        const cards: Card[] = [];
        for (const rank of run) {
          const group = remaining.get(rank);
          if (group) {
            cards.push(...group.splice(0, take));
          }
        }
        results.push(cards);
        extracted = true;
      }
      run = [];
    };

    for (const rank of CHAIN_RANKS) {
      if ((remaining.get(rank)?.length ?? 0) >= need) {
        run.push(rank);
      } else {
        flush();
      }
    }
    flush();
  }
  return results;
}

function takeLeftovers(remaining: Map<Rank, Card[]>): Card[][] {
  const leftovers: Card[][] = [];
  for (const rank of RANKS) {
    const group = remaining.get(rank);
    if (group && group.length > 0) {
      leftovers.push(group.splice(0, group.length));
    }
  }
  return leftovers;
}
