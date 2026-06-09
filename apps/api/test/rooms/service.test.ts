import { describe, expect, it } from "vitest";
import { RoomError } from "../../src/rooms/errors";
import {
  RoomService,
  type CreateRoomInput,
  type RoomRecord,
  type RoomRepository
} from "../../src/rooms/service";

describe("RoomService", () => {
  it("creates and lists open rooms", async () => {
    const service = new RoomService(new InMemoryRoomRepository());

    const created = await service.createRoom({
      code: "ABCD12"
    });
    const list = await service.listOpenRooms();

    expect(created.room.code).toBe("ABCD12");
    expect(created.room.status).toBe("open");
    expect(list.rooms.map((room) => room.code)).toEqual(["ABCD12"]);
  });

  it("rejects duplicate open room codes", async () => {
    const service = new RoomService(new InMemoryRoomRepository());

    await service.createRoom({
      code: "ABCD12"
    });

    await expect(
      service.createRoom({
        code: "ABCD12"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
  });

  it("matches an existing open room before creating a new one", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "OPEN01"
    });
    const matched = await service.matchRoom();

    expect(matched.room.code).toBe("OPEN01");
    expect(rooms.records).toHaveLength(1);
  });

  it("requires rooms to be open before the realtime server can join them", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "OPEN03"
    });
    const joinable = await service.requireJoinableRoom("open03");
    expect(joinable.room.code).toBe("OPEN03");

    await service.updateRoomStatus("OPEN03", "playing");
    await expect(service.requireJoinableRoom("OPEN03")).rejects.toMatchObject({
      statusCode: 404
    } satisfies Partial<RoomError>);
  });

  it("updates room status by code", async () => {
    const service = new RoomService(new InMemoryRoomRepository());
    await service.createRoom({
      code: "OPEN02"
    });

    const updated = await service.updateRoomStatus("open02", "playing");

    expect(updated.room.code).toBe("OPEN02");
    expect(updated.room.status).toBe("playing");
    });
  });

  it("rejects duplicate closed room codes", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "ABCD12"
    });
    await service.updateRoomStatus("ABCD12", "closed");

    await expect(
      service.createRoom({
        code: "ABCD12"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
  });

export class InMemoryRoomRepository implements RoomRepository {
  readonly records: RoomRecord[] = [];

  async listOpenRooms(limit: number): Promise<readonly RoomRecord[]> {
    return this.records
      .filter((room) => room.status === "open")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async findRoomByCode(code: string): Promise<RoomRecord | null> {
    return this.records.find((room) => room.code === code) ?? null;
  }

  async findOpenRoomByCode(code: string): Promise<RoomRecord | null> {
    return this.records.find((room) => room.code === code && room.status === "open") ?? null;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
    const now = new Date(Date.UTC(2026, 0, this.records.length + 1));
    const room = {
      id: `room-${this.records.length + 1}`,
      code: input.code,
      status: input.status,
      createdAt: now,
      updatedAt: now
    };
    this.records.push(room);
    return room;
  }

  async updateRoomStatusByCode(code: string, status: RoomRecord["status"]): Promise<RoomRecord | null> {
    const index = this.records.findIndex((room) => room.code === code);
    if (index === -1) {
      return null;
    }

    const current = this.records[index]!;
    const updated = {
      ...current,
      status,
      updatedAt: new Date(current.updatedAt.getTime() + 1000)
    };
    this.records[index] = updated;
    return updated;
  }
}
