export const RANKS = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
  "SJ",
  "BJ"
] as const;

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type CardId = `${Exclude<Rank, "SJ" | "BJ">}-${Suit}` | "SJ" | "BJ";

export interface Card {
  readonly id: CardId;
  readonly rank: Rank;
  readonly suit?: Suit | undefined;
}

const rankValue = new Map<Rank, number>(RANKS.map((rank, index) => [rank, index]));

export function getRankValue(rank: Rank): number {
  const value = rankValue.get(rank);
  if (value === undefined) {
    throw new Error(`Unknown rank: ${rank}`);
  }
  return value;
}

export function compareRank(a: Rank, b: Rank): number {
  return getRankValue(a) - getRankValue(b);
}

export function createDeck(): Card[] {
  const normalCards = SUITS.flatMap((suit) =>
    RANKS.filter((rank): rank is Exclude<Rank, "SJ" | "BJ"> => rank !== "SJ" && rank !== "BJ").map(
      (rank) => ({
        id: `${rank}-${suit}` as CardId,
        rank,
        suit
      })
    )
  );

  return [
    ...normalCards,
    {
      id: "SJ",
      rank: "SJ"
    },
    {
      id: "BJ",
      rank: "BJ"
    }
  ];
}

export function sortCards(cards: readonly Card[], direction: "asc" | "desc" = "asc"): Card[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...cards].sort((a, b) => {
    const byRank = compareRank(a.rank, b.rank);
    if (byRank !== 0) {
      return byRank * multiplier;
    }
    return a.id.localeCompare(b.id) * multiplier;
  });
}

export function shuffleDeck(deck: readonly Card[], random: () => number = Math.random): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = cards[i];
    const target = cards[j];
    if (current === undefined || target === undefined) {
      throw new Error("Deck index out of bounds while shuffling.");
    }
    cards[i] = target;
    cards[j] = current;
  }
  return cards;
}

export interface DealResult {
  readonly hands: readonly [Card[], Card[], Card[]];
  readonly landlordCards: Card[];
}

export function dealCards(deck: readonly Card[]): DealResult {
  if (deck.length !== 54) {
    throw new Error(`A Dou Dizhu deck must contain 54 cards, received ${deck.length}.`);
  }

  return {
    hands: [
      sortCards(deck.slice(0, 17), "desc"),
      sortCards(deck.slice(17, 34), "desc"),
      sortCards(deck.slice(34, 51), "desc")
    ],
    landlordCards: sortCards(deck.slice(51), "desc")
  };
}

export function parseCardId(id: CardId): Card {
  if (id === "SJ" || id === "BJ") {
    return {
      id,
      rank: id
    };
  }

  const segments = id.split("-");
  const [rank, suit] = segments;
  if (
    segments.length !== 2 ||
    rank === "SJ" ||
    rank === "BJ" ||
    !RANKS.includes(rank as Rank) ||
    !SUITS.includes(suit as Suit)
  ) {
    throw new Error(`Invalid card id: ${id}`);
  }

  return {
    id,
    rank: rank as Exclude<Rank, "SJ" | "BJ">,
    suit: suit as Suit
  };
}

export function parseCardIds(ids: readonly CardId[]): Card[] {
  return ids.map(parseCardId);
}
