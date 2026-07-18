import type { PrismaClient } from "@prisma/client";
import type { RoomStatus } from "@ddz/protocol";
import type { CreateRoomInput, RoomRecord, RoomRepository } from "./service.js";
import { assertRoomStatusTransition } from "./status.js";

type PrismaTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const roomSelect = {
  id: true,
  code: true,
  status: true,
  mode: true,
  createdAt: true,
  updatedAt: true
} as const;

export class PrismaRoomRepository implements RoomRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listOpenRooms(limit: number): Promise<readonly RoomRecord[]> {
    return this.prisma.room.findMany({
      where: {
        status: "open",
        // 竞技场房不能入座，不进普通大厅列表（走 /arena/rooms）
        mode: "standard"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      select: roomSelect
    }) as Promise<RoomRecord[]>;
  }

  async listArenaRooms(limit: number): Promise<readonly RoomRecord[]> {
    return this.prisma.room.findMany({
      where: {
        mode: "arena",
        status: { in: ["open", "playing"] }
      },
      orderBy: {
        updatedAt: "desc"
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

  async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
    return this.prisma.room.create({
      data: input,
      select: roomSelect
    }) as Promise<RoomRecord>;
  }

  async updateRoomStatusByCode(code: string, status: RoomStatus, ownerId: string): Promise<RoomRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const room = await lockRoomByCode(tx, code);
      if (!room) {
        return null;
      }

      const claim = await tx.roomClaim.findUnique({
        where: { roomId: room.id },
        select: { ownerId: true }
      });
      if (claim?.ownerId !== ownerId) {
        return null;
      }
      assertRoomStatusTransition(room.status, status);

      const updated = await tx.room.update({
        where: { id: room.id },
        data: { status },
        select: roomSelect
      });
      if (status === "closed") {
        // 关房与删恢复状态同事务：状态行存在 ⇔ 崩溃可恢复 的不变量由此保证
        await tx.roomLiveState.deleteMany({
          where: { roomId: room.id }
        });
        await tx.roomClaim.deleteMany({
          where: { roomId: room.id }
        });
      }
      return updated as RoomRecord;
    });
  }

  async claimRoom(code: string, ownerId: string, expiresAt: Date, now: Date): Promise<RoomRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const room = await lockRoomByCode(tx, code);
      if (!room || room.status === "closed") {
        return null;
      }

      const claim = await tx.roomClaim.findUnique({
        where: { roomId: room.id },
        select: {
          ownerId: true,
          expiresAt: true
        }
      });
      if (claim && claim.ownerId !== ownerId && claim.expiresAt > now) {
        return null;
      }

      if (claim) {
        await tx.roomClaim.update({
          where: { roomId: room.id },
          data: { ownerId, expiresAt }
        });
      } else {
        await tx.roomClaim.create({
          data: { roomId: room.id, ownerId, expiresAt }
        });
      }

      return toRoomRecord(room);
    });
  }

  async refreshRoomClaim(code: string, ownerId: string, expiresAt: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const room = await lockRoomByCode(tx, code);
      if (!room || room.status === "closed") {
        return false;
      }

      const updated = await tx.roomClaim.updateMany({
        where: {
          roomId: room.id,
          ownerId
        },
        data: {
          expiresAt
        }
      });
      return updated.count === 1;
    });
  }

  async releaseRoomClaim(code: string, ownerId: string): Promise<void> {
    await this.prisma.roomClaim.deleteMany({
      where: {
        room: { code },
        ownerId
      }
    });
  }

  async closeStaleOpenRooms(cutoff: Date): Promise<number> {
    // 只清"从未被使用"的房：被用过的 open 房（如局间休息）即使闲置也可随时重进，清掉反而破坏状态
    const result = await this.prisma.room.updateMany({
      where: {
        status: "open",
        updatedAt: {
          lt: cutoff
        },
        events: {
          none: {}
        },
        rounds: {
          none: {}
        }
      },
      data: {
        status: "closed"
      }
    });
    return result.count;
  }

  async findLiveStateByCode(code: string): Promise<unknown | null> {
    const row = await this.prisma.roomLiveState.findFirst({
      where: {
        room: { code }
      },
      select: {
        state: true
      }
    });
    return row?.state ?? null;
  }

  async closeOrphanPlayingRooms(cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // 恢复状态行随每个游戏动作刷新，长期未刷新即崩溃后无人回来的孤儿房；
      // room.updatedAt 条件保证刚转入 playing 的房不被误杀
      const orphans = await tx.room.findMany({
        where: {
          status: "playing",
          updatedAt: { lt: cutoff },
          OR: [{ liveState: null }, { liveState: { updatedAt: { lt: cutoff } } }]
        },
        select: { id: true }
      });

      if (orphans.length > 0) {
        const ids = orphans.map((room) => room.id);
        await tx.room.updateMany({ where: { id: { in: ids } }, data: { status: "closed" } });
        await tx.roomLiveState.deleteMany({ where: { roomId: { in: ids } } });
        await tx.roomClaim.deleteMany({ where: { roomId: { in: ids } } });
      }

      // 兜底：清掉 closed 房的残留状态行（关房删行竞态的最后防线）
      await tx.roomLiveState.deleteMany({ where: { room: { status: "closed" } } });
      await tx.roomClaim.deleteMany({ where: { room: { status: "closed" } } });
      return orphans.length;
    });
  }
}

async function lockRoomByCode(tx: PrismaTransaction, code: string): Promise<RoomRecord | null> {
  const rows = await tx.$queryRaw<RoomRecord[]>`
    SELECT "id", "code", "status", "mode", "createdAt", "updatedAt"
    FROM "Room"
    WHERE "code" = ${code}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function toRoomRecord(room: {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly mode: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): RoomRecord {
  return room as RoomRecord;
}
