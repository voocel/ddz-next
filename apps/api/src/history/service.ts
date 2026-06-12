import type {
  CoinLedgerResponse,
  RoundActionType,
  RoundHistoryItemDto,
  RoundHistoryResponse,
  RoundReplayResponse
} from "@ddz/protocol";
import { HistoryError } from "./errors.js";

export interface RoundHistoryActionRecord {
  readonly id: string;
  readonly type: RoundActionType;
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface RoundHistoryPlayerRecord {
  readonly playerId: string;
  readonly nickname?: string;
  readonly playerKind: "human" | "bot";
  readonly seat: 0 | 1 | 2;
  readonly score: number;
  readonly coinDelta: number;
}

export interface RoundHistoryRecord {
  readonly id: string;
  readonly room: {
    readonly code: string;
  };
  readonly landlordId: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly players: readonly RoundHistoryPlayerRecord[];
}

export interface RoundReplayRecord extends RoundHistoryRecord {
  readonly actions: readonly RoundHistoryActionRecord[];
}

export interface CoinLedgerRecord {
  readonly id: string;
  readonly roundId: string;
  readonly roomCode: string;
  readonly delta: number;
  readonly balance: number;
  readonly reason: string;
  readonly createdAt: Date;
}

export interface HistoryRepository {
  listRoundsByUserId(userId: string, limit: number): Promise<readonly RoundHistoryRecord[]>;
  findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null>;
  listCoinLedgersByUserId(userId: string, limit: number): Promise<readonly CoinLedgerRecord[]>;
}

export class HistoryService {
  constructor(private readonly history: HistoryRepository) {}

  async listRounds(userId: string): Promise<RoundHistoryResponse> {
    const rounds = await this.history.listRoundsByUserId(userId, 20);
    return {
      rounds: rounds.map(toRoundHistoryDto)
    };
  }

  async getRoundReplay(userId: string, roundId: string): Promise<RoundReplayResponse> {
    const round = await this.history.findRoundByIdForUser(userId, roundId);
    if (!round) {
      throw new HistoryError("Round replay not found.", 404);
    }

    return {
      round: toRoundReplayDto(round)
    };
  }

  async listCoinLedgers(userId: string): Promise<CoinLedgerResponse> {
    const ledgers = await this.history.listCoinLedgersByUserId(userId, 30);
    return {
      ledgers: ledgers.map((ledger) => ({
        id: ledger.id,
        roundId: ledger.roundId,
        roomCode: ledger.roomCode,
        delta: ledger.delta,
        balance: ledger.balance,
        reason: ledger.reason,
        createdAt: ledger.createdAt.toISOString()
      }))
    };
  }
}

function toRoundHistoryDto(round: RoundHistoryRecord): RoundHistoryItemDto {
  return {
    id: round.id,
    roomCode: round.room.code,
    landlordId: round.landlordId,
    startedAt: round.startedAt.toISOString(),
    endedAt: round.endedAt?.toISOString() ?? null,
    players: round.players.map((player) => ({
      playerId: player.playerId,
      ...(player.nickname === undefined ? {} : { nickname: player.nickname }),
      playerKind: player.playerKind,
      seat: player.seat,
      score: player.score,
      coinDelta: player.coinDelta
    }))
  };
}

function toRoundReplayDto(round: RoundReplayRecord): RoundReplayResponse["round"] {
  return {
    ...toRoundHistoryDto(round),
    actions: round.actions.map((action) => ({
      id: action.id,
      type: action.type,
      playerId: action.playerId,
      playerKind: action.playerKind,
      payload: action.payload,
      createdAt: action.createdAt.toISOString()
    }))
  };
}
