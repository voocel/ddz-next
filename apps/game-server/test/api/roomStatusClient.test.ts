import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRoomStatusClient } from "../../src/api/roomStatusClient";

const config = {
  endpoint: "http://api.test",
  internalToken: "internal-test-token",
  retryAttempts: 3,
  retryDelayMs: 0,
  timeoutMs: 5000
};

describe("HttpRoomStatusClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads room state for fresh rooms and crash recovery", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(200, {
        room: {
          id: "room-1",
          code: "ROOM01",
          status: "open",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        state: null
      })
    );

    const result = await new HttpRoomStatusClient(config).getRoomState("ROOM01");
    expect(result.room.status).toBe("open");
    expect(result.state).toBeNull();
    expect(fetch).toHaveBeenCalledWith(new URL("/internal/rooms/ROOM01/state", config.endpoint), {
      method: "GET",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      signal: expect.any(AbortSignal)
    });
  });

  it("syncs room status with a timeout signal", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(new HttpRoomStatusClient(config).updateRoomStatus("ROOM01", "playing")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(new URL("/internal/rooms/ROOM01/status", config.endpoint), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({
        status: "playing"
      }),
      signal: expect.any(AbortSignal)
    });
  });

  it("surfaces API errors when reading room state", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(404, { message: "Room not found." }));

    await expect(new HttpRoomStatusClient(config).getRoomState("ROOM01")).rejects.toThrow(
      "Failed to read state for room ROOM01: 404 Room not found."
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries room state reads after retryable API failures", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503, { message: "busy" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          room: {
            id: "room-1",
            code: "ROOM01",
            status: "open",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          state: null
        })
      );

    await expect(new HttpRoomStatusClient(config).getRoomState("ROOM01")).resolves.toMatchObject({ state: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries room status updates after network failures", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(new HttpRoomStatusClient(config).updateRoomStatus("ROOM01", "closed")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed room state responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(200, {
        room: {
          id: "room-1",
          code: "ROOM01",
          status: "playing",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      })
    );

    await expect(new HttpRoomStatusClient(config).getRoomState("ROOM01")).rejects.toThrow(
      "Invalid room state response for ROOM01"
    );
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
