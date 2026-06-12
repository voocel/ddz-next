import { describe, expect, it } from "vitest";
import { RoomError } from "../../src/rooms/errors";
import { RoomService } from "../../src/rooms/service";
import { InMemoryRoomRepository } from "../helpers";

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

  it("closes stale open rooms and keeps fresh ones", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "STALE1"
    });
    await service.createRoom({
      code: "FRESH1"
    });
    // 第二个房间刚刚活跃过
    await rooms.updateRoomStatusByCode("FRESH1", "open");
    rooms.records[1] = {
      ...rooms.records[1]!,
      updatedAt: new Date()
    };

    // 被使用过的房（有事件/对局）即使闲置也不清
    await service.createRoom({
      code: "USED01"
    });
    rooms.usedCodes.add("USED01");

    const closed = await service.closeStaleRooms(60_000);
    expect(closed).toBe(1);
    expect(rooms.records.find((room) => room.code === "STALE1")?.status).toBe("closed");
    expect(rooms.records.find((room) => room.code === "FRESH1")?.status).toBe("open");
    expect(rooms.records.find((room) => room.code === "USED01")?.status).toBe("open");
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

  it("touches updatedAt on same-status updates so heartbeats fend off the orphan sweep", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);
    await service.createRoom({
      code: "OPEN04"
    });
    const before = rooms.records[0]!.updatedAt.getTime();

    const updated = await service.updateRoomStatus("OPEN04", "open");

    expect(updated.room.status).toBe("open");
    expect(rooms.records[0]!.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it("rejects status transitions out of the closed terminal state", async () => {
    const service = new RoomService(new InMemoryRoomRepository());
    await service.createRoom({
      code: "OPEN05"
    });
    await service.updateRoomStatus("OPEN05", "closed");

    for (const status of ["open", "playing"] as const) {
      await expect(service.updateRoomStatus("OPEN05", status)).rejects.toMatchObject({
        statusCode: 409
      } satisfies Partial<RoomError>);
    }
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
  it("returns room state for crash recovery and clears it on close", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "LIVE01"
    });
    rooms.liveStates.set("LIVE01", { state: { version: 1 }, updatedAt: new Date() });

    const withState = await service.getRoomState("live01");
    expect(withState.room.code).toBe("LIVE01");
    expect(withState.state).toEqual({ version: 1 });

    // 关房删行：closed 后状态不再可恢复
    await service.updateRoomStatus("LIVE01", "closed");
    const afterClose = await service.getRoomState("LIVE01");
    expect(afterClose.room.status).toBe("closed");
    expect(afterClose.state).toBeNull();

    await expect(service.getRoomState("MISSIN")).rejects.toMatchObject({
      statusCode: 404
    } satisfies Partial<RoomError>);
  });

  it("closes orphan playing rooms whose live state stopped refreshing", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({ code: "ORPHA1" });
    await service.updateRoomStatus("ORPHA1", "playing");
    rooms.records[0] = { ...rooms.records[0]!, updatedAt: new Date(Date.now() - 60 * 60_000) };
    rooms.liveStates.set("ORPHA1", { state: { version: 1 }, updatedAt: new Date(Date.now() - 60 * 60_000) });

    // 活跃房：状态行刚刷新过
    await service.createRoom({ code: "ALIVE1" });
    await service.updateRoomStatus("ALIVE1", "playing");
    rooms.records[1] = { ...rooms.records[1]!, updatedAt: new Date(Date.now() - 60 * 60_000) };
    rooms.liveStates.set("ALIVE1", { state: { version: 1 }, updatedAt: new Date() });

    const closed = await service.closeOrphanPlayingRooms(30 * 60_000);

    expect(closed).toBe(1);
    expect(rooms.records.find((room) => room.code === "ORPHA1")?.status).toBe("closed");
    expect(rooms.liveStates.has("ORPHA1")).toBe(false);
    expect(rooms.records.find((room) => room.code === "ALIVE1")?.status).toBe("playing");
  });
});
