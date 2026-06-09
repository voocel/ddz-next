import type { Card, CardId } from "./cards.js";
import { createDeck, dealCards, parseCardIds, shuffleDeck, sortCards } from "./cards.js";
import type { Combination } from "./combinations.js";
import { canBeat, identifyCombination } from "./combinations.js";

export type PlayerId = string;
export type PlayerKind = "human" | "bot";
export type SeatIndex = 0 | 1 | 2;
export type GamePhase = "waiting" | "ready" | "bidding" | "robbing" | "playing" | "settled";

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
      this.currentPlayerId = this.robQueue[0] ?? null;

      if (!this.currentPlayerId) {
        this.finalizeLandlord(playerId);
      }

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
      settlement: this.settlement
    };
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

  private createSettlement(winnerId: PlayerId): Settlement {
    if (!this.landlordId) {
      throw new Error("Cannot settle before landlord is decided.");
    }

    const baseScore = 1;
    const landlordWon = winnerId === this.landlordId;
    const players = [...this.players.values()].sort((a, b) => a.seat - b.seat);

    const settlementPlayers = players.map((player) => {
      const role = player.id === this.landlordId ? "landlord" : "farmer";
      const scoreDelta =
        role === "landlord" ? (landlordWon ? baseScore * 2 : -baseScore * 2) : landlordWon ? -baseScore : baseScore;

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
      players: settlementPlayers
    };
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
