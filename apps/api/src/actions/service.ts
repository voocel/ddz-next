import type { GameActionType, RecordGameAction, RecordGameActionRequest, RoomActionType, RoundActionType } from "@ddz/protocol";
import { roundSettledPayloadSchema } from "@ddz/protocol";
import { createActionFingerprint } from "./actionFingerprint.js";
import { GameActionError } from "./errors.js";

export interface RoundRecord {
  readonly id: string;
  readonly roomId: string;
  readonly endedAt: Date | null;
}

export interface GameActionRecord {
  readonly id: string;
  readonly roundId: string;
  readonly playerId: string | null;
  readonly playerKind: "human" | "bot" | null;
  readonly type: RoundActionType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface RoomEventRecord {
  readonly id: string;
  readonly roomId: string;
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
  }>;
}

export interface GameActionRepository {
  findRoomIdByCode(code: string): Promise<string | null>;
  findOpenRoundByRoomId(roomId: string): Promise<RoundRecord | null>;
  findMutation(roomId: string, mutationId: string): Promise<GameActionMutationRecord | null>;
  recordBatch(input: {
    roomId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
  }): Promise<GameActionMutationRecord>;
}

export class GameActionService {
  constructor(private readonly actions: GameActionRepository) {}

  async record(input: RecordGameActionRequest): Promise<RecordGameActionResult> {
    const roomCode = normalizeRoomCode(input.roomCode);
    const roomId = await this.actions.findRoomIdByCode(roomCode);
    if (!roomId) {
      throw new GameActionError("Room not found.", 404);
    }

    const actionFingerprint = createActionFingerprint(input.actions);
    const existingMutation = await this.actions.findMutation(roomId, input.mutationId);
    if (existingMutation) {
      assertSameMutation(existingMutation, actionFingerprint);
      return toRecordGameActionResult(existingMutation);
    }

    const openRound = await this.actions.findOpenRoundByRoomId(roomId);
    const planned = planActions(input.actions, openRound);
    const result = await this.actions.recordBatch({
      roomId,
      mutationId: input.mutationId,
      actionFingerprint,
      roomEvents: planned.roomEvents,
      roundActions: planned.roundActions
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
      settlement: action.type === "round_settled" ? parseSettlementPayload(action.payload) : null
    });
    if (action.type === "round_settled") {
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

function normalizeRoomCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) {
    throw new GameActionError("Invalid room code.", 400);
  }
  return normalized;
}

function parseSettlementPayload(payload: Record<string, unknown>): RoundSettlementInput {
  const parsed = roundSettledPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GameActionError("Invalid round settlement payload.", 400);
  }

  return {
    landlordId: parsed.data.settlement.landlordId,
    players: parsed.data.settlement.players.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      playerKind: player.playerId.startsWith("bot:") ? "bot" : "human",
      scoreDelta: player.scoreDelta
    }))
  };
}
