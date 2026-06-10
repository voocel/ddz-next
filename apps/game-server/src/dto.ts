import type { Card, Combination, GameSnapshot, PublicPlay, Settlement } from "@ddz/domain";
import type { CardDto, GameSnapshotDto, SettlementDto } from "@ddz/protocol";

export function toCardDto(card: Card): CardDto {
  return {
    id: card.id,
    rank: card.rank,
    ...(card.suit === undefined ? {} : { suit: card.suit })
  };
}

export function toCardsDto(cards: readonly Card[]): CardDto[] {
  return cards.map(toCardDto);
}

export function toCombinationDto(combination: Combination) {
  return {
    kind: combination.kind,
    cards: toCardsDto(combination.cards),
    mainRank: combination.mainRank,
    length: combination.length,
    ...(combination.chainLength === undefined ? {} : { chainLength: combination.chainLength })
  };
}

export function toPublicPlayDto(play: PublicPlay) {
  return {
    playerId: play.playerId,
    cards: toCardsDto(play.cards),
    combination: toCombinationDto(play.combination)
  };
}

export function toSnapshotDto(snapshot: GameSnapshot): GameSnapshotDto {
  return {
    phase: snapshot.phase,
    players: snapshot.players.map((player) => ({ ...player })),
    currentPlayerId: snapshot.currentPlayerId,
    landlordId: snapshot.landlordId,
    bidCandidateId: snapshot.bidCandidateId,
    landlordCards: toCardsDto(snapshot.landlordCards),
    lastPlay: snapshot.lastPlay ? toPublicPlayDto(snapshot.lastPlay) : null,
    passCount: snapshot.passCount,
    multiplier: snapshot.multiplier,
    settlement: snapshot.settlement ? toSettlementDto(snapshot.settlement) : null
  };
}

export function toSettlementDto(settlement: Settlement): SettlementDto {
  return {
    winnerId: settlement.winnerId,
    landlordId: settlement.landlordId,
    landlordWon: settlement.landlordWon,
    baseScore: settlement.baseScore,
    multiplier: settlement.multiplier,
    spring: settlement.spring,
    players: settlement.players.map((player) => ({ ...player }))
  };
}
