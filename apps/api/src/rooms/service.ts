import type { CreateRoomRequest, RoomDto, RoomListResponse, RoomResponse, RoomStatus } from "@ddz/protocol";
import { randomInt } from "node:crypto";
import { RoomError } from "./errors.js";

// 房间状态合法转移表：closed 为终态
const ROOM_STATUS_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  open: ["playing", "closed"],
  playing: ["open", "closed"],
  closed: []
};

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
  findOpenRoomByCode(code: string): Promise<RoomRecord | null>;
  createRoom(input: CreateRoomInput): Promise<RoomRecord>;
  updateRoomStatusByCode(code: string, status: RoomStatus): Promise<RoomRecord | null>;
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
    const code = input.code ? normalizeRoomCode(input.code) : await this.generateUniqueCode();
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

  async matchRoom(): Promise<RoomResponse> {
    const [room] = await this.rooms.listOpenRooms(1);
    if (room) {
      return {
        room: toRoomDto(room)
      };
    }

    return this.createRoom();
  }

  async requireJoinableRoom(code: string): Promise<RoomResponse> {
    const room = await this.rooms.findOpenRoomByCode(normalizeRoomCode(code));
    if (!room) {
      throw new RoomError("Room is not open for joining.", 404);
    }

    return {
      room: toRoomDto(room)
    };
  }

  async updateRoomStatus(code: string, status: RoomStatus): Promise<RoomResponse> {
    const normalized = normalizeRoomCode(code);
    const current = await this.rooms.findRoomByCode(normalized);
    if (!current) {
      throw new RoomError("Room not found.", 404);
    }

    // 同状态更新视为幂等，直接返回；非法转移拒绝
    if (current.status === status) {
      return {
        room: toRoomDto(current)
      };
    }
    if (!ROOM_STATUS_TRANSITIONS[current.status].includes(status)) {
      throw new RoomError(`Cannot change room status from ${current.status} to ${status}.`, 409);
    }

    const room = await this.rooms.updateRoomStatusByCode(normalized, status);
    if (!room) {
      throw new RoomError("Room not found.", 404);
    }

    return {
      room: toRoomDto(room)
    };
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

function createRoomCode(): string {
  // 使用加密安全随机数，避免房间码可预测
  const value = randomInt(0, 36 ** 6);
  return value.toString(36).toUpperCase().padStart(6, "0");
}

function normalizeRoomCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) {
    throw new RoomError("Invalid room code.", 400);
  }
  return normalized;
}
