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

  it("requires rooms to exist and be open before realtime room creation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(200, {
        room: {
          id: "room-1",
          code: "ROOM01",
          status: "open",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      })
    );

    await expect(new HttpRoomStatusClient(config).requireJoinableRoom("ROOM01")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(new URL("/internal/rooms/ROOM01/joinable", config.endpoint), {
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

  it("rejects rooms that the API does not expose as joinable", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(404, { message: "Room is not open for joining." }));

    await expect(new HttpRoomStatusClient(config).requireJoinableRoom("ROOM01")).rejects.toThrow(
      "Room ROOM01 is not joinable: 404 Room is not open for joining."
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries joinable checks after retryable API failures", async () => {
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
          }
        })
      );

    await expect(new HttpRoomStatusClient(config).requireJoinableRoom("ROOM01")).resolves.toBeUndefined();
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

  it("rejects malformed joinable responses", async () => {
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

    await expect(new HttpRoomStatusClient(config).requireJoinableRoom("ROOM01")).rejects.toThrow(
      "Room ROOM01 joinability response does not match the requested open room."
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
