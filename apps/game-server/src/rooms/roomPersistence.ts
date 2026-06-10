import type { GameSnapshot, PlayerId } from "@ddz/domain";
import type { GameActionType, RoomStatus } from "@ddz/protocol";
import { randomUUID } from "node:crypto";
import type { GameActionClient } from "../api/gameActionClient.js";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { toSnapshotDto } from "../dto.js";
import { mapSnapshotToRoomStatus } from "./statusMapping.js";

export interface PendingRoomAction {
  readonly type: GameActionType;
  readonly playerId: PlayerId | null;
  readonly payload: Record<string, unknown>;
  readonly playerKindOverride?: "human" | "bot" | null;
}

export class RoomPersistence {
  private syncedStatus: RoomStatus | null = null;

  constructor(
    private readonly roomCode: string,
    private readonly roomStatusClient: RoomStatusClient,
    private readonly gameActionClient: GameActionClient
  ) {}

  async requireJoinableRoom(): Promise<void> {
    await this.roomStatusClient.requireJoinableRoom(this.roomCode);
  }

  async recordMutation(input: {
    readonly actions: readonly PendingRoomAction[];
    readonly snapshot: GameSnapshot;
  }): Promise<void> {
    try {
      await this.gameActionClient.recordGameActions({
        roomCode: this.roomCode,
        mutationId: this.nextMutationId(),
        actions: input.actions.map((action) => this.toRecordedAction(action, input.snapshot))
      });
      await this.syncStatusAfterSnapshot(input.snapshot);
    } catch (error) {
      throw new RoomPersistenceError("Failed to persist game state.", error);
    }
  }

  /** 房间销毁时把 DB 状态收尾为 closed，避免停留在 playing。 */
  async closeRoom(): Promise<void> {
    if (this.syncedStatus === "closed") {
      return;
    }

    await this.roomStatusClient.updateRoomStatus(this.roomCode, "closed");
    this.syncedStatus = "closed";
  }

  async closeFailedRoom(reason: string, snapshot: GameSnapshot): Promise<void> {
    await this.roomStatusClient.updateRoomStatus(this.roomCode, "closed");
    this.syncedStatus = "closed";
    await this.gameActionClient.recordGameActions({
      roomCode: this.roomCode,
      mutationId: this.nextMutationId(),
      actions: [
        {
          playerId: null,
          playerKind: null,
          type: "room_failed",
          payload: {
            reason,
            snapshot: toSnapshotDto(snapshot)
          }
        }
      ]
    });
  }

  private async syncStatusAfterSnapshot(snapshot: GameSnapshot): Promise<void> {
    const status = mapSnapshotToRoomStatus(snapshot);
    if (status === this.syncedStatus) {
      return;
    }

    await this.roomStatusClient.updateRoomStatus(this.roomCode, status);
    this.syncedStatus = status;
  }

  private nextMutationId(): string {
    return randomUUID();
  }

  private toRecordedAction(action: PendingRoomAction, snapshot: GameSnapshot): {
    readonly playerId: PlayerId | null;
    readonly playerKind: "human" | "bot" | null;
    readonly type: GameActionType;
    readonly payload: Record<string, unknown>;
  } {
    return {
      playerId: action.playerId,
      playerKind: action.playerId ? action.playerKindOverride ?? readPlayerKind(action.playerId, snapshot) : null,
      type: action.type,
      payload: {
        ...action.payload,
        snapshot: toSnapshotDto(snapshot)
      }
    };
  }
}

export class RoomPersistenceError extends Error {
  constructor(
    message: string,
    readonly originalError: unknown
  ) {
    super(message, {
      cause: originalError
    });
    this.name = "RoomPersistenceError";
  }
}

function readPlayerKind(playerId: PlayerId, snapshot: GameSnapshot): "human" | "bot" {
  const player = snapshot.players.find((item) => item.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player.kind;
}
