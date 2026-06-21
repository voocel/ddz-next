import { describe, expect, it } from "vitest";
import { RoomError } from "../../src/rooms/errors";
import { RoomService } from "../../src/rooms/service";
import { InMemoryRoomRepository } from "../helpers";

describe("RoomService", () => {
  it("creates and lists open rooms", async () => {
    const service = new RoomService(new InMemoryRoomRepository());

    const created = await service.createRoom({
      code: "100012"
    });
    const list = await service.listOpenRooms();

    expect(created.room.code).toBe("100012");
    expect(created.room.status).toBe("open");
    expect(list.rooms.map((room) => room.code)).toEqual(["100012"]);
  });

  it("rejects duplicate open room codes", async () => {
    const service = new RoomService(new InMemoryRoomRepository());

    await service.createRoom({
      code: "100012"
    });

    await expect(
      service.createRoom({
        code: "100012"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
  });

  it("closes stale open rooms and keeps fresh ones", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "100001"
    });
    await service.createRoom({
      code: "100002"
    });
    // 第二个房间刚刚活跃过
    await rooms.claimRoom("100002", "owner-a", new Date(Date.now() + 60_000), new Date());
    await rooms.updateRoomStatusByCode("100002", "open", "owner-a");
    rooms.records[1] = {
      ...rooms.records[1]!,
      updatedAt: new Date()
    };

    // 被使用过的房（有事件/对局）即使闲置也不清
    await service.createRoom({
      code: "100003"
    });
    rooms.usedCodes.add("100003");

    const closed = await service.closeStaleRooms(60_000);
    expect(closed).toBe(1);
    expect(rooms.records.find((room) => room.code === "100001")?.status).toBe("closed");
    expect(rooms.records.find((room) => room.code === "100002")?.status).toBe("open");
    expect(rooms.records.find((room) => room.code === "100003")?.status).toBe("open");
  });

  it("updates room status by code", async () => {
    const service = new RoomService(new InMemoryRoomRepository());
    await service.createRoom({
      code: "100020"
    });
    await expect(service.updateRoomStatus("100020", "playing", "owner-a")).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
    await service.claimRoom("100020", "owner-a", 60_000);

    const updated = await service.updateRoomStatus("100020", "playing", "owner-a");

    expect(updated.room.code).toBe("100020");
    expect(updated.room.status).toBe("playing");
  });

  it("claims rooms exclusively until the lease expires", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);
    await service.createRoom({ code: "100030" });

    await expect(service.claimRoom("100030", "owner-a", 60_000)).resolves.toMatchObject({
      room: { code: "100030" }
    });
    await expect(service.claimRoom("100030", "owner-b", 60_000)).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);

    rooms.claims.set("100030", {
      ownerId: "owner-a",
      expiresAt: new Date(Date.now() - 1),
      updatedAt: new Date(Date.now() - 60_000)
    });
    await expect(service.claimRoom("100030", "owner-b", 60_000)).resolves.toMatchObject({
      room: { code: "100030" }
    });

    await expect(service.refreshRoomClaim("100030", "owner-a", 60_000)).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
    await expect(service.refreshRoomClaim("100030", "owner-b", 60_000)).resolves.toBeUndefined();
    await service.releaseRoomClaim("100030", "owner-b");
    expect(rooms.claims.has("100030")).toBe(false);
  });

  it("touches updatedAt on same-status updates so heartbeats fend off the orphan sweep", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);
    await service.createRoom({
      code: "100040"
    });
    await service.claimRoom("100040", "owner-a", 60_000);
    const before = rooms.records[0]!.updatedAt.getTime();

    const updated = await service.updateRoomStatus("100040", "open", "owner-a");

    expect(updated.room.status).toBe("open");
    expect(rooms.records[0]!.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it("rejects status transitions out of the closed terminal state", async () => {
    const service = new RoomService(new InMemoryRoomRepository());
    await service.createRoom({
      code: "100050"
    });
    await service.claimRoom("100050", "owner-a", 60_000);
    await service.updateRoomStatus("100050", "closed", "owner-a");

    for (const status of ["open", "playing"] as const) {
      await expect(service.updateRoomStatus("100050", status, "owner-a")).rejects.toMatchObject({
        statusCode: 409
      } satisfies Partial<RoomError>);
    }
  });

  it("clears room claims when a room is closed", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);
    await service.createRoom({ code: "100060" });
    await service.claimRoom("100060", "owner-a", 60_000);

    await service.updateRoomStatus("100060", "closed", "owner-a");

    expect(rooms.claims.has("100060")).toBe(false);
  });

  it("rejects duplicate closed room codes", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "100012"
    });
    await service.claimRoom("100012", "owner-a", 60_000);
    await service.updateRoomStatus("100012", "closed", "owner-a");

    await expect(
      service.createRoom({
        code: "100012"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<RoomError>);
  });
  it("returns room state for crash recovery and clears it on close", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({
      code: "100101"
    });
    await service.claimRoom("100101", "owner-a", 60_000);
    rooms.liveStates.set("100101", { state: { version: 1 }, updatedAt: new Date() });

    const withState = await service.getRoomState("100101");
    expect(withState.room.code).toBe("100101");
    expect(withState.state).toEqual({ version: 1 });

    // 关房删行：closed 后状态不再可恢复
    await service.updateRoomStatus("100101", "closed", "owner-a");
    const afterClose = await service.getRoomState("100101");
    expect(afterClose.room.status).toBe("closed");
    expect(afterClose.state).toBeNull();

    await expect(service.getRoomState("999999")).rejects.toMatchObject({
      statusCode: 404
    } satisfies Partial<RoomError>);
  });

  it("closes orphan playing rooms whose live state stopped refreshing", async () => {
    const rooms = new InMemoryRoomRepository();
    const service = new RoomService(rooms);

    await service.createRoom({ code: "100201" });
    await service.claimRoom("100201", "owner-a", 60_000);
    await service.updateRoomStatus("100201", "playing", "owner-a");
    rooms.records[0] = { ...rooms.records[0]!, updatedAt: new Date(Date.now() - 60 * 60_000) };
    rooms.liveStates.set("100201", { state: { version: 1 }, updatedAt: new Date(Date.now() - 60 * 60_000) });
    rooms.claims.set("100201", {
      ownerId: "owner-a",
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date()
    });

    // 活跃房：状态行刚刷新过
    await service.createRoom({ code: "100202" });
    await service.claimRoom("100202", "owner-a", 60_000);
    await service.updateRoomStatus("100202", "playing", "owner-a");
    rooms.records[1] = { ...rooms.records[1]!, updatedAt: new Date(Date.now() - 60 * 60_000) };
    rooms.liveStates.set("100202", { state: { version: 1 }, updatedAt: new Date() });

    const closed = await service.closeOrphanPlayingRooms(30 * 60_000);

    expect(closed).toBe(1);
    expect(rooms.records.find((room) => room.code === "100201")?.status).toBe("closed");
    expect(rooms.liveStates.has("100201")).toBe(false);
    expect(rooms.claims.has("100201")).toBe(false);
    expect(rooms.records.find((room) => room.code === "100202")?.status).toBe("playing");
  });
});
