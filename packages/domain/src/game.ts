import type { Card, CardId } from "./cards.js";
import { createDeck, dealCards, parseCardIds, shuffleDeck, sortCards } from "./cards.js";
import type { Combination } from "./combinations.js";
import { canBeat, identifyCombination } from "./combinations.js";

export type PlayerId = string;
export type PlayerKind = "human" | "bot";
export type SeatIndex = 0 | 1 | 2;

export const GAME_PHASES = ["waiting", "ready", "bidding", "robbing", "playing", "settled"] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export interface PlayerSnapshot {
  readonly id: PlayerId;
  readonly kind: PlayerKind;
  readonly seat: SeatIndex;
  readonly ready: boolean;
  readonly handCount: number;
  readonly connected: boolean;
  readonly score: number;
}

export interface GameSnapshot {
  readonly phase: GamePhase;
  readonly players: readonly PlayerSnapshot[];
  readonly currentPlayerId: PlayerId | null;
  readonly landlordId: PlayerId | null;
  readonly bidCandidateId: PlayerId | null;
  readonly landlordCards: readonly Card[];
  readonly lastPlay: PublicPlay | null;
  readonly passCount: number;
  readonly multiplier: number;
  readonly settlement: Settlement | null;
}

export interface PublicPlay {
  readonly playerId: PlayerId;
  readonly cards: readonly Card[];
  readonly combination: Combination;
}

export interface SettlementPlayer {
  readonly playerId: PlayerId;
  readonly seat: SeatIndex;
  readonly role: "landlord" | "farmer";
  readonly handCount: number;
  readonly scoreDelta: number;
  readonly totalScore: number;
}

export interface Settlement {
  readonly winnerId: PlayerId;
  readonly landlordId: PlayerId;
  readonly landlordWon: boolean;
  readonly baseScore: number;
  readonly multiplier: number;
  readonly spring: boolean;
  readonly players: readonly SettlementPlayer[];
}

export interface BidResult {
  readonly playerId: PlayerId;
  readonly called: boolean;
  readonly redealt: boolean;
  readonly snapshot: GameSnapshot;
}

export interface RobResult {
  readonly playerId: PlayerId;
  readonly robbed: boolean;
  readonly decided: boolean;
  readonly landlordId: PlayerId | null;
  readonly snapshot: GameSnapshot;
}

export interface ReadyResult {
  readonly playerId: PlayerId;
  readonly roundStarted: boolean;
  readonly snapshot: GameSnapshot;
}

interface PlayerState {
  readonly id: PlayerId;
  readonly kind: PlayerKind;
  seat: SeatIndex;
  ready: boolean;
  connected: boolean;
  hand: Card[];
  score: number;
}

export interface GameTablePlayerState {
  readonly id: PlayerId;
  readonly kind: PlayerKind;
  readonly seat: SeatIndex;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly hand: readonly CardId[];
  readonly score: number;
}

/** GameTable 的完整可序列化状态（含手牌），用于崩溃恢复。牌以 CardId 存储，restore 时重建。 */
export interface GameTableState {
  readonly phase: GamePhase;
  readonly players: readonly GameTablePlayerState[];
  readonly currentPlayerId: PlayerId | null;
  readonly landlordId: PlayerId | null;
  readonly bidCandidateId: PlayerId | null;
  readonly landlordCards: readonly CardId[];
  readonly bottomCards: readonly CardId[];
  readonly lastPlay: { readonly playerId: PlayerId; readonly cards: readonly CardId[] } | null;
  readonly settlement: Settlement | null;
  readonly passCount: number;
  readonly bidAttempts: number;
  readonly robQueue: readonly PlayerId[];
  readonly robIndex: number;
  readonly robCount: number;
  readonly bombCount: number;
  readonly playCounts: Readonly<Record<PlayerId, number>>;
}

export class GameTable {
  private readonly players = new Map<PlayerId, PlayerState>();
  private phase: GamePhase = "waiting";
  private currentPlayerId: PlayerId | null = null;
  private landlordId: PlayerId | null = null;
  private bidCandidateId: PlayerId | null = null;
  private landlordCards: Card[] = [];
  private bottomCards: Card[] = [];
  private lastPlay: PublicPlay | null = null;
  private settlement: Settlement | null = null;
  private passCount = 0;
  private bidAttempts = 0;
  private robQueue: PlayerId[] = [];
  private robIndex = 0;
  private robCount = 0;
  private bombCount = 0;
  private readonly playCounts = new Map<PlayerId, number>();

  addPlayer(playerId: PlayerId): SeatIndex {
    if (this.players.has(playerId)) {
      const seat = this.players.get(playerId)?.seat;
      if (seat === undefined) {
        throw new Error(`Player ${playerId} exists without a seat.`);
      }
      return seat;
    }

    if (this.players.size >= 3) {
      throw new Error("The table is full.");
    }

    const seat = this.players.size as SeatIndex;
    this.players.set(playerId, {
      id: playerId,
      kind: "human",
      seat,
      ready: false,
      connected: true,
      hand: [],
      score: 0
    });

    if (this.players.size === 3) {
      this.phase = "ready";
    }

    return seat;
  }

  addBot(playerId: PlayerId): SeatIndex {
    if (!playerId.startsWith("bot:")) {
      throw new Error("Bot player ids must use the bot: prefix.");
    }

    if (this.players.has(playerId)) {
      const seat = this.players.get(playerId)?.seat;
      if (seat === undefined) {
        throw new Error(`Bot ${playerId} exists without a seat.`);
      }
      return seat;
    }

    if (this.players.size >= 3) {
      throw new Error("The table is full.");
    }

    const seat = this.players.size as SeatIndex;
    this.players.set(playerId, {
      id: playerId,
      kind: "bot",
      seat,
      ready: false,
      connected: true,
      hand: [],
      score: 0
    });

    if (this.players.size === 3) {
      this.phase = "ready";
    }

    return seat;
  }

  removePlayerBeforeRound(playerId: PlayerId): void {
    if (this.phase !== "waiting" && this.phase !== "ready") {
      throw new Error(`Cannot remove players during ${this.phase} phase.`);
    }

    const player = this.getPlayer(playerId);
    if (player.kind !== "human") {
      throw new Error("Only human players can leave seats before a round starts.");
    }

    this.players.delete(playerId);
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    players.forEach((item, index) => {
      item.seat = index as SeatIndex;
    });
    this.phase = this.players.size === 3 ? "ready" : "waiting";
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.players.has(playerId);
  }

  setConnected(playerId: PlayerId, connected: boolean): void {
    this.getPlayer(playerId).connected = connected;
  }

  setReady(playerId: PlayerId): ReadyResult {
    if (this.phase !== "waiting" && this.phase !== "ready") {
      throw new Error(`Cannot ready during ${this.phase} phase.`);
    }

    const player = this.getPlayer(playerId);
    player.ready = true;

    if (this.players.size === 3 && [...this.players.values()].every((item) => item.ready)) {
      this.dealForBidding();
      return {
        playerId,
        roundStarted: true,
        snapshot: this.snapshot()
      };
    }

    return {
      playerId,
      roundStarted: false,
      snapshot: this.snapshot()
    };
  }

  bidLandlord(playerId: PlayerId, called: boolean): BidResult {
    if (this.phase !== "bidding") {
      throw new Error(`Cannot bid during ${this.phase} phase.`);
    }

    if (playerId !== this.currentPlayerId) {
      throw new Error("It is not this player's bidding turn.");
    }

    if (called) {
      this.bidCandidateId = playerId;
      this.robQueue = this.otherPlayersInTurnOrder(playerId);
      this.robIndex = 0;
      this.phase = "robbing";
      this.currentPlayerId = this.robQueue[0]!;

      return {
        playerId,
        called,
        redealt: false,
        snapshot: this.snapshot()
      };
    }

    this.bidAttempts += 1;
    if (this.bidAttempts >= this.players.size) {
      this.dealForBidding();
      return {
        playerId,
        called,
        redealt: true,
        snapshot: this.snapshot()
      };
    }

    this.currentPlayerId = this.nextPlayerId(playerId);

    return {
      playerId,
      called,
      redealt: false,
      snapshot: this.snapshot()
    };
  }

  robLandlord(playerId: PlayerId, robbed: boolean): RobResult {
    if (this.phase !== "robbing") {
      throw new Error(`Cannot rob landlord during ${this.phase} phase.`);
    }

    if (playerId !== this.currentPlayerId) {
      throw new Error("It is not this player's robbing turn.");
    }

    if (!this.bidCandidateId) {
      throw new Error("Cannot rob landlord before a player has called landlord.");
    }

    if (robbed) {
      this.bidCandidateId = playerId;
      this.robCount += 1;
    }

    this.robIndex += 1;

    if (this.robIndex >= this.robQueue.length) {
      const landlordId = this.bidCandidateId;
      this.finalizeLandlord(landlordId);
      return {
        playerId,
        robbed,
        decided: true,
        landlordId,
        snapshot: this.snapshot()
      };
    }

    this.currentPlayerId = this.robQueue[this.robIndex] ?? null;

    return {
      playerId,
      robbed,
      decided: false,
      landlordId: null,
      snapshot: this.snapshot()
    };
  }

  playCards(playerId: PlayerId, cardIds: readonly CardId[]): PublicPlay {
    if (this.phase !== "playing") {
      throw new Error(`Cannot play cards during ${this.phase} phase.`);
    }

    if (playerId !== this.currentPlayerId) {
      throw new Error("It is not this player's turn.");
    }

    const player = this.getPlayer(playerId);
    const selected = this.takeCardsFromHand(player, cardIds);
    const combination = identifyCombination(selected);
    if (!combination) {
      throw new Error("Invalid card combination.");
    }

    if (!canBeat(combination, this.lastPlay?.combination ?? null)) {
      throw new Error("Card combination cannot beat the previous play.");
    }

    player.hand = removeCards(player.hand, selected);
    const play = {
      playerId,
      cards: selected,
      combination
    };

    if (combination.kind === "bomb" || combination.kind === "rocket") {
      this.bombCount += 1;
    }
    this.playCounts.set(playerId, (this.playCounts.get(playerId) ?? 0) + 1);
    this.lastPlay = play;
    this.passCount = 0;

    if (player.hand.length === 0) {
      this.settlement = this.createSettlement(playerId);
      this.phase = "settled";
      this.currentPlayerId = null;
    } else {
      this.currentPlayerId = this.nextPlayerId(playerId);
    }

    return play;
  }

  pass(playerId: PlayerId): void {
    if (this.phase !== "playing") {
      throw new Error(`Cannot pass during ${this.phase} phase.`);
    }

    if (playerId !== this.currentPlayerId) {
      throw new Error("It is not this player's turn.");
    }

    if (!this.lastPlay) {
      throw new Error("Cannot pass before any cards have been played.");
    }

    this.passCount += 1;
    if (this.passCount >= 2) {
      this.currentPlayerId = this.lastPlay.playerId;
      this.lastPlay = null;
      this.passCount = 0;
      return;
    }

    this.currentPlayerId = this.nextPlayerId(playerId);
  }

  getHand(playerId: PlayerId): readonly Card[] {
    return this.getPlayer(playerId).hand;
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      players: [...this.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((player) => ({
          id: player.id,
          kind: player.kind,
          seat: player.seat,
          ready: player.ready,
          handCount: player.hand.length,
          connected: player.connected,
          score: player.score
        })),
      currentPlayerId: this.currentPlayerId,
      landlordId: this.landlordId,
      bidCandidateId: this.bidCandidateId,
      landlordCards: this.landlordCards,
      lastPlay: this.lastPlay,
      passCount: this.passCount,
      multiplier: this.currentMultiplier(),
      settlement: this.settlement
    };
  }

  /** 导出完整内部状态（含手牌）供崩溃恢复使用，与 snapshot() 的公开视图互补。 */
  dump(): GameTableState {
    return {
      phase: this.phase,
      players: [...this.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((player) => ({
          id: player.id,
          kind: player.kind,
          seat: player.seat,
          ready: player.ready,
          connected: player.connected,
          hand: player.hand.map((card) => card.id),
          score: player.score
        })),
      currentPlayerId: this.currentPlayerId,
      landlordId: this.landlordId,
      bidCandidateId: this.bidCandidateId,
      landlordCards: this.landlordCards.map((card) => card.id),
      bottomCards: this.bottomCards.map((card) => card.id),
      lastPlay: this.lastPlay
        ? { playerId: this.lastPlay.playerId, cards: this.lastPlay.cards.map((card) => card.id) }
        : null,
      settlement: this.settlement,
      passCount: this.passCount,
      bidAttempts: this.bidAttempts,
      robQueue: [...this.robQueue],
      robIndex: this.robIndex,
      robCount: this.robCount,
      bombCount: this.bombCount,
      playCounts: Object.fromEntries(this.playCounts)
    };
  }

  /** 崩溃恢复：在全新实例上还原 dump() 导出的状态，结构非法即抛错。 */
  restore(state: GameTableState): void {
    if (this.players.size > 0 || this.phase !== "waiting") {
      throw new Error("Can only restore into a fresh table.");
    }

    validateTableState(state);

    for (const player of state.players) {
      this.players.set(player.id, {
        id: player.id,
        kind: player.kind,
        seat: player.seat,
        ready: player.ready,
        connected: player.connected,
        hand: parseCardIds(player.hand),
        score: player.score
      });
    }

    this.phase = state.phase;
    this.currentPlayerId = state.currentPlayerId;
    this.landlordId = state.landlordId;
    this.bidCandidateId = state.bidCandidateId;
    this.landlordCards = parseCardIds(state.landlordCards);
    this.bottomCards = parseCardIds(state.bottomCards);
    this.lastPlay = state.lastPlay ? rebuildPlay(state.lastPlay) : null;
    this.settlement = state.settlement;
    this.passCount = state.passCount;
    this.bidAttempts = state.bidAttempts;
    this.robQueue = [...state.robQueue];
    this.robIndex = state.robIndex;
    this.robCount = state.robCount;
    this.bombCount = state.bombCount;
    this.playCounts.clear();
    for (const [playerId, count] of Object.entries(state.playCounts)) {
      this.playCounts.set(playerId, count);
    }
  }

  /** 结算后开启下一局：保留玩家与累计分，清空牌局状态，回到 ready/waiting。 */
  resetForNextRound(): GameSnapshot {
    if (this.phase !== "settled") {
      throw new Error(`Cannot reset during ${this.phase} phase.`);
    }

    for (const player of this.players.values()) {
      player.ready = false;
      player.hand = [];
    }

    this.currentPlayerId = null;
    this.landlordId = null;
    this.bidCandidateId = null;
    this.landlordCards = [];
    this.bottomCards = [];
    this.lastPlay = null;
    this.settlement = null;
    this.passCount = 0;
    this.bidAttempts = 0;
    this.robQueue = [];
    this.robIndex = 0;
    this.robCount = 0;
    this.bombCount = 0;
    this.playCounts.clear();
    this.phase = this.players.size === 3 ? "ready" : "waiting";
    return this.snapshot();
  }

  private dealForBidding(): void {
    const deck = shuffleDeck(createDeck());
    const deal = dealCards(deck);
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);

    players.forEach((player, index) => {
      player.hand = [...deal.hands[index]!.map((card) => ({ ...card }))];
      player.ready = false;
    });

    this.bottomCards = [...deal.landlordCards];
    this.landlordCards = [];
    this.landlordId = null;
    this.bidCandidateId = null;
    this.currentPlayerId = players[0]?.id ?? null;
    this.lastPlay = null;
    this.settlement = null;
    this.passCount = 0;
    this.bidAttempts = 0;
    this.robQueue = [];
    this.robIndex = 0;
    this.robCount = 0;
    this.bombCount = 0;
    this.playCounts.clear();
    this.phase = "bidding";
  }

  private finalizeLandlord(landlordId: PlayerId): void {
    const landlord = this.getPlayer(landlordId);
    landlord.hand = sortCards([...landlord.hand, ...this.bottomCards], "desc");
    this.landlordCards = [...this.bottomCards];
    this.bottomCards = [];
    this.landlordId = landlordId;
    this.currentPlayerId = landlordId;
    this.lastPlay = null;
    this.settlement = null;
    this.passCount = 0;
    this.robQueue = [];
    this.robIndex = 0;
    this.phase = "playing";
  }

  private takeCardsFromHand(player: PlayerState, cardIds: readonly CardId[]): Card[] {
    if (new Set(cardIds).size !== cardIds.length) {
      throw new Error("Duplicate card selection.");
    }

    const requested = parseCardIds(cardIds);
    const availableIds = new Set(player.hand.map((card) => card.id));

    for (const card of requested) {
      if (!availableIds.has(card.id)) {
        throw new Error(`Player does not hold card ${card.id}.`);
      }
    }

    return sortCards(requested, "asc");
  }

  private getPlayer(playerId: PlayerId): PlayerState {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error(`Unknown player: ${playerId}`);
    }
    return player;
  }

  private nextPlayerId(playerId: PlayerId): PlayerId {
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    const index = players.findIndex((player) => player.id === playerId);
    if (index === -1) {
      throw new Error(`Unknown player: ${playerId}`);
    }
    return players[(index + 1) % players.length]!.id;
  }

  private otherPlayersInTurnOrder(playerId: PlayerId): PlayerId[] {
    const result: PlayerId[] = [];
    let next = this.nextPlayerId(playerId);

    while (next !== playerId) {
      result.push(next);
      next = this.nextPlayerId(next);
    }

    return result;
  }

  private currentMultiplier(): number {
    return 2 ** (this.robCount + this.bombCount);
  }

  private isSpring(landlordWon: boolean): boolean {
    if (!this.landlordId) {
      return false;
    }

    if (landlordWon) {
      // 春天：两位农民整局没出过一手牌。
      return [...this.players.values()]
        .filter((player) => player.id !== this.landlordId)
        .every((player) => (this.playCounts.get(player.id) ?? 0) === 0);
    }

    // 反春：地主只出过首手就被农民打完。
    return (this.playCounts.get(this.landlordId) ?? 0) <= 1;
  }

  private createSettlement(winnerId: PlayerId): Settlement {
    if (!this.landlordId) {
      throw new Error("Cannot settle before landlord is decided.");
    }

    const baseScore = 1;
    const landlordWon = winnerId === this.landlordId;
    const spring = this.isSpring(landlordWon);
    const multiplier = this.currentMultiplier() * (spring ? 2 : 1);
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);

    const settlementPlayers = players.map((player) => {
      const role = player.id === this.landlordId ? "landlord" : "farmer";
      const farmerDelta = baseScore * multiplier;
      const scoreDelta =
        role === "landlord" ? (landlordWon ? farmerDelta * 2 : -farmerDelta * 2) : landlordWon ? -farmerDelta : farmerDelta;

      player.score += scoreDelta;

      return {
        playerId: player.id,
        seat: player.seat,
        role,
        handCount: player.hand.length,
        scoreDelta,
        totalScore: player.score
      } satisfies SettlementPlayer;
    });

    return {
      winnerId,
      landlordId: this.landlordId,
      landlordWon,
      baseScore,
      multiplier,
      spring,
      players: settlementPlayers
    };
  }
}

/** lastPlay 只存 CardId，重建时确定性重算 combination；牌型非法说明数据已损坏。 */
function rebuildPlay(play: { readonly playerId: PlayerId; readonly cards: readonly CardId[] }): PublicPlay {
  const cards = sortCards(parseCardIds(play.cards), "asc");
  const combination = identifyCombination(cards);
  if (!combination) {
    throw new Error("Restored lastPlay is not a valid combination.");
  }
  return { playerId: play.playerId, cards, combination };
}

function validateTableState(state: GameTableState): void {
  const fail = (reason: string): never => {
    throw new Error(`Invalid table state: ${reason}`);
  };

  if (!GAME_PHASES.includes(state.phase)) {
    fail(`unknown phase ${state.phase}`);
  }
  if (state.phase !== "waiting" && state.players.length !== 3) {
    fail(`phase ${state.phase} requires 3 players`);
  }
  if (state.players.length > 3) {
    fail("too many players");
  }

  const playerIds = new Set(state.players.map((player) => player.id));
  if (playerIds.size !== state.players.length) {
    fail("duplicate player ids");
  }
  const seats = new Set(state.players.map((player) => player.seat));
  if (state.players.some((player, _, all) => player.seat < 0 || player.seat >= all.length) || seats.size !== state.players.length) {
    fail("seats must be unique and contiguous from 0");
  }

  const belongs = (playerId: PlayerId | null, label: string): void => {
    if (playerId !== null && !playerIds.has(playerId)) {
      fail(`${label} ${playerId} is not seated`);
    }
  };
  belongs(state.currentPlayerId, "currentPlayerId");
  belongs(state.landlordId, "landlordId");
  belongs(state.bidCandidateId, "bidCandidateId");
  for (const playerId of state.robQueue) {
    belongs(playerId, "robQueue entry");
  }
  for (const playerId of Object.keys(state.playCounts)) {
    belongs(playerId, "playCounts entry");
  }

  // landlordCards 是已并入地主手牌的公开拷贝，唯一性只看手牌 + 未发底牌
  const dealtIds = [...state.players.flatMap((player) => player.hand), ...state.bottomCards];
  if (new Set(dealtIds).size !== dealtIds.length) {
    fail("duplicate cards across hands and bottom cards");
  }

  switch (state.phase) {
    case "bidding":
      if (state.landlordId !== null || state.bidCandidateId !== null || state.currentPlayerId === null || state.bottomCards.length !== 3) {
        fail("inconsistent bidding state");
      }
      break;
    case "robbing":
      if (state.landlordId !== null || state.bidCandidateId === null || state.currentPlayerId === null) {
        fail("inconsistent robbing state");
      }
      if (state.bottomCards.length !== 3 || state.robIndex >= state.robQueue.length) {
        fail("inconsistent rob queue state");
      }
      break;
    case "playing":
      if (state.landlordId === null || state.currentPlayerId === null || state.bottomCards.length !== 0 || state.landlordCards.length !== 3) {
        fail("inconsistent playing state");
      }
      break;
    case "settled":
      if (state.landlordId === null || state.settlement === null || state.currentPlayerId !== null) {
        fail("inconsistent settled state");
      }
      break;
    case "waiting":
    case "ready":
      if (state.players.some((player) => player.hand.length > 0) || state.currentPlayerId !== null || state.landlordId !== null) {
        fail(`inconsistent ${state.phase} state`);
      }
      break;
  }
}

function removeCards(hand: readonly Card[], selected: readonly Card[]): Card[] {
  const selectedIds = new Map<CardId, number>();
  for (const card of selected) {
    selectedIds.set(card.id, (selectedIds.get(card.id) ?? 0) + 1);
  }

  return hand.filter((card) => {
    const count = selectedIds.get(card.id) ?? 0;
    if (count <= 0) {
      return true;
    }
    selectedIds.set(card.id, count - 1);
    return false;
  });
}
