import type { CreateRoomRequest, RoomDto, RoomListResponse, RoomResponse, RoomStatus } from "@ddz/protocol";
import { RoomError } from "./errors.js";
import { createRoomCode, normalizeRoomCode } from "./roomCode.js";
import { assertRoomStatusTransition } from "./status.js";

export interface RoomRecord {
  readonly id: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateRoomInput {
  readonly code: string;
  readonly status: RoomStatus;
}

export interface RoomRepository {
  listOpenRooms(limit: number): Promise<readonly RoomRecord[]>;
  findRoomByCode(code: string): Promise<RoomRecord | null>;
  createRoom(input: CreateRoomInput): Promise<RoomRecord>;
  updateRoomStatusByCode(code: string, status: RoomStatus, ownerId: string): Promise<RoomRecord | null>;
  claimRoom(code: string, ownerId: string, expiresAt: Date, now: Date): Promise<RoomRecord | null>;
  refreshRoomClaim(code: string, ownerId: string, expiresAt: Date): Promise<boolean>;
  releaseRoomClaim(code: string, ownerId: string): Promise<void>;
  /** 关闭 updatedAt 早于 cutoff 且从未被使用过（无事件无对局）的 open 房，返回关闭数量 */
  closeStaleOpenRooms(cutoff: Date): Promise<number>;
  /** 读取崩溃恢复状态（信封原样返回，无行则 null） */
  findLiveStateByCode(code: string): Promise<unknown | null>;
  /** 关闭恢复状态长期未刷新（game-server 宕机后无人回来）的 playing 孤儿房并删状态行 */
  closeOrphanPlayingRooms(cutoff: Date): Promise<number>;
}

export class RoomService {
  constructor(private readonly rooms: RoomRepository) {}

  async listOpenRooms(): Promise<RoomListResponse> {
    const rooms = await this.rooms.listOpenRooms(20);
    return {
      rooms: rooms.map(toRoomDto)
    };
  }

  async createRoom(input: CreateRoomRequest = {}): Promise<RoomResponse> {
    const code = input.code ? requireRoomCode(input.code) : await this.generateUniqueCode();
    const existing = await this.rooms.findRoomByCode(code);
    if (existing) {
      throw new RoomError("Room code already exists.", 409);
    }

    const room = await this.rooms.createRoom({
      code,
      status: "open"
    });

    return {
      room: toRoomDto(room)
    };
  }

  /** 清扫创建后从未被使用的 open 房，避免长期占据房间列表 */
  async closeStaleRooms(maxIdleMs: number): Promise<number> {
    return this.rooms.closeStaleOpenRooms(new Date(Date.now() - maxIdleMs));
  }

  /** 清扫崩溃后无人回来恢复的 playing 孤儿房 */
  async closeOrphanPlayingRooms(maxIdleMs: number): Promise<number> {
    return this.rooms.closeOrphanPlayingRooms(new Date(Date.now() - maxIdleMs));
  }

  /** 崩溃恢复查询：房间 + 完整牌局状态（手牌敏感，仅 internal 通道使用） */
  async getRoomState(code: string): Promise<{ room: RoomDto; state: unknown | null }> {
    const room = await this.rooms.findRoomByCode(requireRoomCode(code));
    if (!room) {
      throw new RoomError("Room not found.", 404);
    }

    const state = room.status === "closed" ? null : await this.rooms.findLiveStateByCode(room.code);
    return {
      room: toRoomDto(room),
      state
    };
  }

  async updateRoomStatus(code: string, status: RoomStatus, ownerId: string): Promise<RoomResponse> {
    const normalized = requireRoomCode(code);
    const current = await this.rooms.findRoomByCode(normalized);
    if (!current) {
      throw new RoomError("Room not found.", 404);
    }

    // 同状态更新仍写库以刷新 updatedAt：game-server 以此作活跃心跳，免于孤儿清扫；非法转移拒绝
    assertRoomStatusTransition(current.status, status);

    const room = await this.rooms.updateRoomStatusByCode(normalized, status, requireOwnerId(ownerId));
    if (!room) {
      throw new RoomError("Room claim is not held by this game server.", 409);
    }

    return {
      room: toRoomDto(room)
    };
  }

  async claimRoom(code: string, ownerId: string, ttlMs: number): Promise<RoomResponse> {
    const normalized = requireRoomCode(code);
    const room = await this.rooms.claimRoom(normalized, requireOwnerId(ownerId), new Date(Date.now() + ttlMs), new Date());
    if (!room) {
      throw new RoomError("Room is already claimed by another game server.", 409);
    }

    return {
      room: toRoomDto(room)
    };
  }

  async refreshRoomClaim(code: string, ownerId: string, ttlMs: number): Promise<void> {
    const updated = await this.rooms.refreshRoomClaim(requireRoomCode(code), requireOwnerId(ownerId), new Date(Date.now() + ttlMs));
    if (!updated) {
      throw new RoomError("Room claim is not held by this game server.", 409);
    }
  }

  async releaseRoomClaim(code: string, ownerId: string): Promise<void> {
    await this.rooms.releaseRoomClaim(requireRoomCode(code), requireOwnerId(ownerId));
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = createRoomCode();
      const existing = await this.rooms.findRoomByCode(code);
      if (!existing) {
        return code;
      }
    }

    throw new RoomError("Unable to allocate a unique room code.", 503);
  }
}

export function toRoomDto(room: RoomRecord): RoomDto {
  return {
    id: room.id,
    code: room.code,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString()
  };
}

function requireRoomCode(raw: string): string {
  const code = normalizeRoomCode(raw);
  if (!code) {
    throw new RoomError("Invalid room code.", 400);
  }
  return code;
}

function requireOwnerId(raw: string): string {
  const ownerId = raw.trim();
  if (!ownerId) {
    throw new RoomError("Claim owner id is required.", 400);
  }
  return ownerId;
}
