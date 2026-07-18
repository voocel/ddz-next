import type {
  GameActionType,
  RecordGameAction,
  RecordGameActionRequest,
  RoomStatus,
  RoomActionType,
  RoomLiveStateEnvelope,
  RoundActionType
} from "@ddz/protocol";
import { roundAbortedPayloadSchema, roundSettledPayloadSchema } from "@ddz/protocol";
import { createActionFingerprint } from "./actionFingerprint.js";
import { GameActionError } from "./errors.js";
import { normalizeRoomCode } from "../rooms/roomCode.js";

export interface RoundRecord {
  readonly id: string;
  readonly roomId: string;
  readonly endedAt: Date | null;
}

export interface GameActionRecord {
  readonly id: string;
  readonly roundId: string;
  readonly seq: number;
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly type: RoundActionType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface RoomEventRecord {
  readonly id: string;
  readonly roomId: string;
  readonly seq: number;
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly type: RoomActionType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface RecordGameActionResult {
  readonly roomEventIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly roundId: string | null;
}

export interface GameActionMutationRecord extends RecordGameActionResult {
  readonly mutationId: string;
  readonly actionFingerprint: string;
}

export interface RoundSettlementInput {
  readonly landlordId: string;
  readonly players: ReadonlyArray<{
    readonly playerId: string;
    readonly playerKind: "human" | "bot";
    readonly seat: number;
    readonly scoreDelta: number;
    /** LLM bot 的模型身份;真人与规则 bot 为 null。供排行/战绩按模型聚合。 */
    readonly botProvider: string | null;
    readonly botModel: string | null;
  }>;
}

/** 流局输入:关闭 Round(记原因与技术负归属),并写零分 RoundPlayer 行保留模型身份供排行聚合。 */
export interface RoundAbortInput {
  readonly reason: string;
  readonly failedPlayerId: string | null;
  readonly players: ReadonlyArray<{
    readonly playerId: string;
    readonly playerKind: "human" | "bot";
    readonly seat: number;
    readonly botProvider: string | null;
    readonly botModel: string | null;
  }>;
}

export interface GameActionRepository {
  findRoomIdByCode(code: string): Promise<string | null>;
  findOpenRoundByRoomId(roomId: string): Promise<RoundRecord | null>;
  findMutation(roomId: string, mutationId: string): Promise<GameActionMutationRecord | null>;
  recordBatch(input: {
    roomId: string;
    ownerId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
    /** 与动作同事务更新房间状态；null 表示仅写动作/恢复状态。 */
    status: RoomStatus | null;
    /** 崩溃恢复状态，与动作同事务 upsert；幂等命中时无需补写（首次提交已含） */
    state: RoomLiveStateEnvelope | null;
  }): Promise<GameActionMutationRecord>;
}

export class GameActionService {
  constructor(private readonly actions: GameActionRepository) {}

  async record(input: RecordGameActionRequest): Promise<RecordGameActionResult> {
    const roomCode = normalizeRoomCode(input.roomCode);
    if (!roomCode) {
      throw new GameActionError("Invalid room code.", 400);
    }
    const roomId = await this.actions.findRoomIdByCode(roomCode);
    if (!roomId) {
      throw new GameActionError("Room not found.", 404);
    }

    const actionFingerprint = createActionFingerprint({
      actions: input.actions,
      ...(input.status === undefined ? {} : { status: input.status })
    });
    const existingMutation = await this.actions.findMutation(roomId, input.mutationId);
    if (existingMutation) {
      assertSameMutation(existingMutation, actionFingerprint);
      return toRecordGameActionResult(existingMutation);
    }

    const openRound = await this.actions.findOpenRoundByRoomId(roomId);
    const planned = planActions(input.actions, openRound);
    const result = await this.actions.recordBatch({
      roomId,
      ownerId: input.ownerId,
      mutationId: input.mutationId,
      actionFingerprint,
      roomEvents: planned.roomEvents,
      roundActions: planned.roundActions,
      status: input.status ?? null,
      state: input.state ?? null
    });

    return toRecordGameActionResult(result);
  }
}

export interface RoomEventInput {
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly type: RoomActionType;
  readonly payload: Record<string, unknown>;
}

export interface RoundActionInput {
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly type: RoundActionType;
  readonly payload: Record<string, unknown>;
  readonly settlement: RoundSettlementInput | null;
  readonly abort: RoundAbortInput | null;
}

function planActions(actions: readonly RecordGameAction[], openRound: RoundRecord | null): {
  readonly roomEvents: readonly RoomEventInput[];
  readonly roundActions: readonly RoundActionInput[];
} {
  const roomEvents: RoomEventInput[] = [];
  const roundActions: RoundActionInput[] = [];
  let roundIsAvailable = Boolean(openRound);

  for (const action of actions) {
    if (isRoomActionType(action.type)) {
      roomEvents.push({
        playerId: action.playerId,
        playerKind: action.playerKind,
        type: action.type,
        payload: action.payload
      });
      continue;
    }

    if (action.type === "round_started") {
      if (roundIsAvailable) {
        throw new GameActionError("Cannot start a round while another round is open.", 409);
      }
      roundIsAvailable = true;
    } else if (!roundIsAvailable) {
      throw new GameActionError(`Cannot record ${action.type} without an open round.`, 409);
    }

    roundActions.push({
      playerId: action.playerId,
      playerKind: action.playerKind,
      type: action.type,
      payload: action.payload,
      settlement: action.type === "round_settled" ? parseSettlementPayload(action.payload) : null,
      abort: action.type === "round_aborted" ? parseAbortPayload(action.payload) : null
    });
    // 结算与流局都终结当前局
    if (action.type === "round_settled" || action.type === "round_aborted") {
      roundIsAvailable = false;
    }
  }

  return {
    roomEvents,
    roundActions
  };
}

function assertSameMutation(mutation: GameActionMutationRecord, actionFingerprint: string): void {
  if (mutation.actionFingerprint !== actionFingerprint) {
    throw new GameActionError("Mutation id was already used for different game actions.", 409);
  }
}

function toRecordGameActionResult(mutation: GameActionMutationRecord): RecordGameActionResult {
  return {
    roomEventIds: mutation.roomEventIds,
    actionIds: mutation.actionIds,
    roundId: mutation.roundId
  };
}

function isRoomActionType(type: GameActionType): type is RoomActionType {
  return type === "player_joined" || type === "player_left" || type === "player_ready" || type === "room_failed";
}

function parseSettlementPayload(payload: Record<string, unknown>): RoundSettlementInput {
  const parsed = roundSettledPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GameActionError("Invalid round settlement payload.", 400);
  }

  const botPlayers = parsed.data.botPlayers ?? {};
  return {
    landlordId: parsed.data.settlement.landlordId,
    players: parsed.data.settlement.players.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      playerKind: player.playerId.startsWith("bot:") ? "bot" : "human",
      scoreDelta: player.scoreDelta,
      botProvider: botPlayers[player.playerId]?.provider ?? null,
      botModel: botPlayers[player.playerId]?.model ?? null
    }))
  };
}

function parseAbortPayload(payload: Record<string, unknown>): RoundAbortInput {
  const parsed = roundAbortedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GameActionError("Invalid round abort payload.", 400);
  }

  const botPlayers = parsed.data.botPlayers ?? {};
  return {
    reason: parsed.data.reason,
    failedPlayerId: parsed.data.failedPlayerId,
    players: parsed.data.players.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      playerKind: player.playerId.startsWith("bot:") ? "bot" : "human",
      botProvider: botPlayers[player.playerId]?.provider ?? null,
      botModel: botPlayers[player.playerId]?.model ?? null
    }))
  };
}
