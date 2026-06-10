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

  it("treats same-status updates as idempotent", async () => {
    const service = new RoomService(new InMemoryRoomRepository());
    await service.createRoom({
      code: "OPEN04"
    });

    const updated = await service.updateRoomStatus("OPEN04", "open");

    expect(updated.room.status).toBe("open");
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
});
