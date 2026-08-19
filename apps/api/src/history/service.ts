import type {
  CardDto,
  RoundActionType,
  RoundHistoryItemDto,
  RoundHistoryResponse,
  RoundReplayResponse
} from "@ddz/protocol";
import { cardSchema } from "@ddz/protocol";
import { HistoryError } from "./errors.js";

export interface RoundHistoryActionRecord {
  readonly id: string;
  readonly seq: number;
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
  readonly botProvider?: string | null;
  readonly botModel?: string | null;
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

export interface HistoryRepository {
  listRoundsByUserId(userId: string, limit: number): Promise<readonly RoundHistoryRecord[]>;
  findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null>;
  /** 公开复盘查询：仅命中全 bot 的已结束局（有真人参与即视为不存在，保护真人手牌隐私） */
  findPublicBotRoundById(roundId: string): Promise<RoundReplayRecord | null>;
  /** 最近的全 bot 已结算局（流局不含），公开对局列表用 */
  listRecentBotRounds(limit: number): Promise<readonly RoundHistoryRecord[]>;
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
      round: toRoundReplayDto(round, userId)
    };
  }

  /** 公开复盘：全 bot 局明牌下发（revealedHands），真人局在仓储层即不可见 */
  async getPublicRoundReplay(roundId: string): Promise<RoundReplayResponse> {
    const round = await this.history.findPublicBotRoundById(roundId);
    if (!round) {
      throw new HistoryError("Round replay not found.", 404);
    }

    return {
      round: {
        ...toRoundReplayDto(round, null),
        revealedHands: readRevealedHands(round)
      }
    };
  }

  /** 最近的公开 AI 对局（全 bot 已结算局），复盘入口列表 */
  async listRecentBotReplays(): Promise<RoundHistoryResponse> {
    const rounds = await this.history.listRecentBotRounds(20);
    return {
      rounds: rounds.map(toRoundHistoryDto)
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
      ...(player.botProvider && player.botModel
        ? { model: { provider: player.botProvider, model: player.botModel } }
        : {}),
      playerKind: player.playerKind,
      seat: player.seat,
      score: player.score
    }))
  };
}

function toRoundReplayDto(round: RoundReplayRecord, userId: string | null): RoundReplayResponse["round"] {
  return {
    ...toRoundHistoryDto(round),
    viewerInitialHand: userId === null ? [] : readInitialHand(round, userId),
    revealedHands: [],
    actions: round.actions.map((action) => ({
      id: action.id,
      seq: action.seq,
      type: action.type,
      playerId: action.playerId,
      playerKind: action.playerKind,
      payload: action.payload,
      createdAt: action.createdAt.toISOString()
    }))
  };
}

function readInitialHand(round: RoundReplayRecord, playerId: string): CardDto[] {
  const started = round.actions.find((action) => action.type === "round_started");
  const initialHands = readObject(started?.payload.initialHands);
  const hand = readUnknownArray(initialHands?.[playerId]);
  if (!hand) {
    return [];
  }

  return hand.map((cardId) => {
    const parsed = cardSchema.safeParse(readReplayCard(cardId));
    if (!parsed.success) {
      throw new HistoryError("Round replay contains an invalid initial hand.", 500);
    }
    return parsed.data;
  });
}

/** 明牌复盘的三家初始手牌：按座位序展开 round_started 落库的 initialHands */
function readRevealedHands(round: RoundReplayRecord): RoundReplayResponse["round"]["revealedHands"] {
  return round.players
    .map((player) => ({
      playerId: player.playerId,
      cards: readInitialHand(round, player.playerId)
    }))
    .filter((entry) => entry.cards.length > 0);
}

function readReplayCard(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value === "SJ" || value === "BJ") {
    return {
      id: value,
      rank: value
    };
  }

  const separator = value.indexOf("-");
  if (separator <= 0) {
    return value;
  }

  return {
    id: value,
    rank: value.slice(0, separator),
    suit: value.slice(separator + 1)
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readUnknownArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
