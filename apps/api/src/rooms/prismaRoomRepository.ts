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

    // 关房与删恢复状态同事务：状态行存在 ⇔ 崩溃可恢复 的不变量由此保证
    if (status === "closed") {
      const [updated] = await this.prisma.$transaction([
        this.prisma.room.update({
          where: { code },
          data: { status },
          select: roomSelect
        }),
        this.prisma.roomLiveState.deleteMany({
          where: { roomId: room.id }
        })
      ]);
      return updated as RoomRecord;
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
        await tx.roomLiveState.deleteMany({ where: { roomId: { in: ids } } });
        await tx.room.updateMany({ where: { id: { in: ids } }, data: { status: "closed" } });
      }

      // 兜底：清掉 closed 房的残留状态行（关房删行竞态的最后防线）
      await tx.roomLiveState.deleteMany({ where: { room: { status: "closed" } } });
      return orphans.length;
    });
  }
}
