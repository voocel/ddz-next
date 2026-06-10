import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { DdzRoom } from "../../src/rooms/DdzRoom";

describe("DdzRoom.failRoom", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("broadcasts a generic reason to clients before reporting the failure to the API", async () => {
    const fixture = createRoomFixture();

    await fixture.failRoom(new Error("db exploded"), "Failed to persist game state.");

    // 广播优先于 API 上报，且两步各自独立执行
    expect(fixture.calls).toEqual(["cancelAll", "broadcast", "closeFailedRoom"]);
    // 客户端只收到通用文案，详细错误不外泄
    const payload = fixture.broadcast.mock.calls[0]?.[1] as { reason: string };
    expect(payload.reason).not.toContain("db exploded");
    // API 上报携带详细原因，便于排查
    expect(fixture.closeFailedRoom.mock.calls[0]?.[0]).toBe("db exploded");
    expect(fixture.disconnect).toHaveBeenCalledWith(1011);
  });

  it("is idempotent: repeated failures are handled only once", async () => {
    const fixture = createRoomFixture();

    await fixture.failRoom(new Error("first"), "Failed to persist game state.");
    await fixture.failRoom(new Error("second"), "Failed to persist player leave.");

    expect(fixture.closeFailedRoom).toHaveBeenCalledTimes(1);
    expect(fixture.broadcast).toHaveBeenCalledTimes(1);
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
  });

  it("still locks and disconnects when the API close report fails", async () => {
    const fixture = createRoomFixture();
    fixture.closeFailedRoom.mockRejectedValueOnce(new Error("api down"));

    await fixture.failRoom(new Error("boom"), "Failed to persist game state.");

    expect(fixture.broadcast).toHaveBeenCalledTimes(1);
    expect(fixture.lock).toHaveBeenCalledTimes(1);
    expect(fixture.disconnect).toHaveBeenCalledWith(1011);
  });
});

interface RoomFixture {
  readonly broadcast: ReturnType<typeof vi.fn>;
  readonly calls: string[];
  readonly closeFailedRoom: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly failRoom: (error: unknown, defaultReason: string) => Promise<void>;
  readonly lock: ReturnType<typeof vi.fn>;
}

function createRoomFixture(): RoomFixture {
  const room = new DdzRoom();
  const calls: string[] = [];
  const broadcast = vi.fn(() => {
    calls.push("broadcast");
  });
  const closeFailedRoom = vi.fn(async () => {
    calls.push("closeFailedRoom");
  });
  const lock = vi.fn(async () => {});
  const disconnect = vi.fn(async () => {});

  // 注入私有依赖的最小桩，避免拉起完整的 Colyseus 运行时
  const internals = room as unknown as Record<string, unknown>;
  internals.roomCode = "TESTROOM";
  internals.turnScheduler = {
    cancelAll: () => {
      calls.push("cancelAll");
    }
  };
  internals.persistence = {
    closeFailedRoom
  };
  internals.broadcast = broadcast;
  internals.lock = lock;
  internals.disconnect = disconnect;

  return {
    broadcast,
    calls,
    closeFailedRoom,
    disconnect,
    lock,
    failRoom: (error: unknown, defaultReason: string) =>
      (room as unknown as { failRoom(error: unknown, defaultReason: string): Promise<void> }).failRoom(error, defaultReason)
  };
}
