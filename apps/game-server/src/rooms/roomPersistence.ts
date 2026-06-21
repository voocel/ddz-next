import type { GameSnapshot, PlayerId } from "@ddz/domain";
import type { GameActionType, RoomLiveStateEnvelope, RoomStatus } from "@ddz/protocol";
import { randomUUID } from "node:crypto";
import type { GameActionClient } from "../api/gameActionClient.js";
import type { RoomStatusClient } from "../api/roomStatusClient.js";
import { readPlayerKind, toSnapshotDto } from "../dto.js";
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
    private readonly gameActionClient: GameActionClient,
    /** 每次落库随动作携带的崩溃恢复信封；房间串行队列保证与 snapshot 同刻一致 */
    private readonly dumpState: () => RoomLiveStateEnvelope,
    private readonly claimOwnerId: string,
    private readonly claimTtlMs: number
  ) {}

  async claimRoom(): Promise<void> {
    await this.roomStatusClient.claimRoom(this.roomCode, this.claimOwnerId, this.claimTtlMs);
  }

  async releaseClaim(): Promise<void> {
    await this.roomStatusClient.releaseRoomClaim(this.roomCode, this.claimOwnerId, this.claimTtlMs);
  }

  async recordMutation(input: {
    readonly actions: readonly PendingRoomAction[];
    readonly snapshot: GameSnapshot;
  }): Promise<void> {
    try {
      const status = mapSnapshotToRoomStatus(input.snapshot);
      await this.gameActionClient.recordGameActions({
        roomCode: this.roomCode,
        ownerId: this.claimOwnerId,
        mutationId: this.nextMutationId(),
        actions: input.actions.map((action) => this.toRecordedAction(action, input.snapshot)),
        status,
        state: this.dumpState()
      });
      this.syncedStatus = status;
    } catch (error) {
      throw new RoomPersistenceError("Failed to persist game state.", error);
    }
  }

  /** 周期心跳：重申当前状态以刷新 Room.updatedAt，活房免于被孤儿清扫误杀。 */
  async heartbeat(): Promise<void> {
    if (this.syncedStatus === "closed") {
      return;
    }

    await this.roomStatusClient.refreshRoomClaim(this.roomCode, this.claimOwnerId, this.claimTtlMs);
    if (this.syncedStatus !== null) {
      await this.roomStatusClient.updateRoomStatus(this.roomCode, this.syncedStatus, this.claimOwnerId);
    }
  }

  /** 房间销毁时把 DB 状态收尾为 closed，避免停留在 playing。 */
  async closeRoom(): Promise<void> {
    if (this.syncedStatus === "closed") {
      return;
    }

    await this.roomStatusClient.updateRoomStatus(this.roomCode, "closed", this.claimOwnerId);
    this.syncedStatus = "closed";
  }

  async closeFailedRoom(reason: string, snapshot: GameSnapshot): Promise<void> {
    await this.gameActionClient.recordGameActions({
      roomCode: this.roomCode,
      ownerId: this.claimOwnerId,
      mutationId: this.nextMutationId(),
      status: "closed",
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
    this.syncedStatus = "closed";
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
