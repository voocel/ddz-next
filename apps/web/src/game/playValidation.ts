import { canBeat, identifyCombination, type Card, type CardId, type Combination } from "@ddz/domain";
import type { CardDto, GameSnapshotDto } from "@ddz/protocol";

export type PlayValidationResult =
  | {
      readonly ok: true;
      readonly cardIds: readonly CardId[];
      readonly combination: Combination;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export function validateSelectedPlay(
  hand: readonly CardDto[],
  selectedIds: ReadonlySet<CardId>,
  snapshot: GameSnapshotDto | null,
  localPlayerId: string
): PlayValidationResult {
  if (snapshot?.phase !== "playing") {
    return {
      ok: false,
      reason: "当前不是出牌阶段"
    };
  }

  if (!localPlayerId) {
    return {
      ok: false,
      reason: "尚未绑定本地玩家"
    };
  }

  if (snapshot.currentPlayerId !== localPlayerId) {
    return {
      ok: false,
      reason: "还没轮到你出牌"
    };
  }

  if (selectedIds.size === 0) {
    return {
      ok: false,
      reason: "请选择要出的牌"
    };
  }

  const selectedCards = readSelectedCards(hand, selectedIds);
  if (selectedCards.length !== selectedIds.size) {
    return {
      ok: false,
      reason: "所选牌不在手牌中"
    };
  }

  const combination = identifyCombination(selectedCards);
  if (!combination) {
    return {
      ok: false,
      reason: "所选牌不是合法牌型"
    };
  }

  const previous = readPreviousCombination(snapshot.lastPlay);
  if (!canBeat(combination, previous)) {
    return {
      ok: false,
      reason: "所选牌压不过上一手"
    };
  }

  return {
    ok: true,
    cardIds: selectedCards.map((card) => card.id),
    combination
  };
}

export function describeSelectedCards(hand: readonly CardDto[], selectedIds: ReadonlySet<CardId>): string {
  if (selectedIds.size === 0) {
    return "未选牌";
  }

  const selectedCards = readSelectedCards(hand, selectedIds);
  const combination = identifyCombination(selectedCards);
  if (!combination) {
    return `${selectedCards.length} 张，牌型无效`;
  }

  return `${combinationKindLabel(combination.kind)} ${selectedCards.map(formatCardLabel).join(" ")}`;
}

export function combinationKindLabel(kind: Combination["kind"]): string {
  const labels: Record<Combination["kind"], string> = {
    single: "单牌",
    pair: "对子",
    trio: "三张",
    trio_with_single: "三带一",
    trio_with_pair: "三带一对",
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
  return labels[kind];
}

function readSelectedCards(hand: readonly CardDto[], selectedIds: ReadonlySet<CardId>): Card[] {
  return hand.filter((card) => selectedIds.has(card.id)).map(toDomainCard);
}

function readPreviousCombination(play: GameSnapshotDto["lastPlay"]): Combination | null {
  if (!play) {
    return null;
  }

  return identifyCombination(play.cards.map(toDomainCard));
}

export function toDomainCard(card: CardDto): Card {
  if (card.suit === undefined) {
    return {
      id: card.id,
      rank: card.rank
    };
  }

  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit
  };
}

function formatCardLabel(card: Card): string {
  if (card.id === "SJ") {
    return "小王";
  }
  if (card.id === "BJ") {
    return "大王";
  }

  const suit = card.suit === "hearts" ? "红桃" : card.suit === "diamonds" ? "方块" : card.suit === "spades" ? "黑桃" : "梅花";
  return `${suit}${card.rank}`;
}
