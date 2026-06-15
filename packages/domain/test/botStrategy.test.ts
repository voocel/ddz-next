import { describe, expect, it } from "vitest";
import type { BotPlayView, CardId, Combination } from "../src";
import { decideBotPlay, decomposeHand, identifyCombination, parseCardIds } from "../src";

function hand(ids: readonly CardId[]) {
  return parseCardIds([...ids]);
}

function combo(ids: readonly CardId[]): Combination {
  const result = identifyCombination(parseCardIds([...ids]));
  if (!result) {
    throw new Error(`Invalid combination for test: ${ids.join(",")}`);
  }
  return result;
}

function view(overrides: Partial<BotPlayView>): BotPlayView {
  return {
    hand: [],
    previous: null,
    previousBy: null,
    selfId: "me",
    landlordId: "me",
    players: [],
    playedCards: [],
    ...overrides
  };
}

describe("decomposeHand", () => {
  it("保留对子,不会拆成两张单牌", () => {
    const kinds = decomposeHand(hand(["3-clubs", "3-hearts", "9-spades"])).map((c) => c.kind);
    expect(kinds).toContain("pair");
    expect(kinds).not.toContain("rocket");
  });

  it("识别顺子而不是五张单牌", () => {
    const combos = decomposeHand(hand(["3-clubs", "4-hearts", "5-spades", "6-clubs", "7-diamonds"]));
    expect(combos).toHaveLength(1);
    expect(combos[0]?.kind).toBe("straight");
  });

  it("分解是完整划分:覆盖且不重复每一张牌", () => {
    const ids: CardId[] = [
      "3-clubs", "3-hearts", "4-spades", "5-clubs", "6-hearts", "7-spades", "8-clubs",
      "9-hearts", "10-spades", "J-clubs", "Q-hearts", "K-spades", "A-clubs", "2-hearts",
      "2-spades", "SJ", "BJ"
    ];
    const combos = decomposeHand(hand(ids));
    const decomposedIds = combos.flatMap((c) => c.cards.map((card) => card.id));
    expect(decomposedIds).toHaveLength(ids.length);
    expect(new Set(decomposedIds)).toEqual(new Set(ids));
  });
});

describe("decideBotPlay - 领出", () => {
  it("领出最低价值的可弃组合,不拆低对子", () => {
    const play = decideBotPlay(view({ hand: hand(["3-clubs", "3-hearts", "9-spades"]) }));
    expect(play).not.toBeNull();
    expect(play).toHaveLength(2);
    expect(play?.every((card) => card.rank === "3")).toBe(true);
  });

  it("保留控制牌(2/王),优先甩普通牌", () => {
    const play = decideBotPlay(view({ hand: hand(["5-clubs", "2-hearts", "BJ"]) }));
    expect(play).not.toBeNull();
    expect(play?.[0]?.rank).toBe("5");
  });
});

describe("decideBotPlay - 跟牌", () => {
  const players = [
    { id: "landlord", handCount: 8 },
    { id: "me", handCount: 9 },
    { id: "mate", handCount: 7 }
  ];

  it("农民不压自己的队友", () => {
    const play = decideBotPlay(
      view({
        hand: hand(["6-clubs"]),
        previous: combo(["5-clubs"]),
        previousBy: "mate",
        selfId: "me",
        landlordId: "landlord",
        players
      })
    );
    expect(play).toBeNull();
  });

  it("农民会压地主(对手)", () => {
    const play = decideBotPlay(
      view({
        hand: hand(["6-clubs"]),
        previous: combo(["5-clubs"]),
        previousBy: "landlord",
        selfId: "me",
        landlordId: "landlord",
        players
      })
    );
    expect(play).not.toBeNull();
    expect(play?.[0]?.rank).toBe("6");
  });

  it("对手手数充裕时不为小牌浪费炸弹", () => {
    const play = decideBotPlay(
      view({
        hand: hand(["9-clubs", "9-hearts", "9-spades", "9-diamonds"]),
        previous: combo(["A-clubs", "A-hearts"]),
        previousBy: "mate",
        selfId: "landlord",
        landlordId: "landlord",
        players: [
          { id: "landlord", handCount: 4 },
          { id: "mate", handCount: 10 },
          { id: "other", handCount: 11 }
        ]
      })
    );
    expect(play).toBeNull();
  });

  it("对手即将走完时动用炸弹拦截", () => {
    const play = decideBotPlay(
      view({
        hand: hand(["9-clubs", "9-hearts", "9-spades", "9-diamonds"]),
        previous: combo(["A-clubs", "A-hearts"]),
        previousBy: "mate",
        selfId: "landlord",
        landlordId: "landlord",
        players: [
          { id: "landlord", handCount: 4 },
          { id: "mate", handCount: 2 },
          { id: "other", handCount: 11 }
        ]
      })
    );
    expect(play).toHaveLength(4);
  });
});

describe("decideBotPlay - 记牌大牌意识", () => {
  // 上家(地主)出单 9,我能压的最小单牌只有 2;关键在于 2 是否还是当前最大单牌。
  const baseFollow = {
    hand: hand(["2-clubs", "3-clubs", "4-clubs", "5-clubs", "6-clubs", "7-clubs"]),
    previous: combo(["9-clubs"]),
    previousBy: "landlord",
    selfId: "me",
    landlordId: "landlord",
    players: [
      { id: "landlord", handCount: 9 },
      { id: "me", handCount: 6 },
      { id: "mate", handCount: 8 }
    ]
  } as const;

  it("双王已出尽,2 成绝对大牌时留着不压小牌", () => {
    const play = decideBotPlay(view({ ...baseFollow, playedCards: hand(["SJ", "BJ"]) }));
    expect(play).toBeNull();
  });

  it("双王仍在场,2 可能被压,则正常出牌", () => {
    const play = decideBotPlay(view({ ...baseFollow, playedCards: [] }));
    expect(play).not.toBeNull();
    expect(play?.[0]?.rank).toBe("2");
  });

  it("对手只剩少量牌时,绝对大牌也抢着压不再藏", () => {
    const play = decideBotPlay(
      view({
        ...baseFollow,
        playedCards: hand(["SJ", "BJ"]),
        players: [
          { id: "landlord", handCount: 3 },
          { id: "me", handCount: 6 },
          { id: "mate", handCount: 8 }
        ]
      })
    );
    expect(play?.[0]?.rank).toBe("2");
  });

  it("残局(这一手能走完)即便是绝对大牌也照出", () => {
    const play = decideBotPlay(
      view({
        ...baseFollow,
        hand: hand(["2-clubs"]),
        playedCards: hand(["SJ", "BJ"]),
        players: [
          { id: "landlord", handCount: 9 },
          { id: "me", handCount: 1 },
          { id: "mate", handCount: 8 }
        ]
      })
    );
    expect(play).toEqual(hand(["2-clubs"]));
  });
});
