import type { PrismaClient } from "@prisma/client";
import type { RoomStatus } from "@ddz/protocol";
import type { CreateRoomInput, RoomRecord, RoomRepository } from "./service.js";

const roomSelect = {
  id: true,
  code: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const;

export class PrismaRoomRepository implements RoomRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listOpenRooms(limit: number): Promise<readonly RoomRecord[]> {
    return this.prisma.room.findMany({
      where: {
        status: "open"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      select: roomSelect
    }) as Promise<RoomRecord[]>;
  }

  async findRoomByCode(code: string): Promise<RoomRecord | null> {
    return this.prisma.room.findUnique({
      where: {
        code
      },
      select: roomSelect
    }) as Promise<RoomRecord | null>;
  }

  async findOpenRoomByCode(code: string): Promise<RoomRecord | null> {
    return this.prisma.room.findFirst({
      where: {
        code,
        status: "open"
      },
      select: roomSelect
    }) as Promise<RoomRecord | null>;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
    return this.prisma.room.create({
      data: input,
      select: roomSelect
    }) as Promise<RoomRecord>;
  }

  async updateRoomStatusByCode(code: string, status: RoomStatus): Promise<RoomRecord | null> {
    const room = await this.prisma.room.findUnique({
      where: {
        code
      },
      select: {
        id: true
      }
    });
    if (!room) {
      return null;
    }

    return this.prisma.room.update({
      where: {
        code
      },
      data: {
        status
      },
      select: roomSelect
    }) as Promise<RoomRecord>;
  }
}
