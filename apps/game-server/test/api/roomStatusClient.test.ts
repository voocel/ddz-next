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
          code: "100001",
          status: "open",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        state: null
      })
    );

    const result = await new HttpRoomStatusClient(config).getRoomState("100001");
    expect(result.room.status).toBe("open");
    expect(result.state).toBeNull();
    expect(fetch).toHaveBeenCalledWith(new URL("/internal/rooms/100001/state", config.endpoint), {
      method: "GET",
      headers: {
        "x-ddz-internal-token": "internal-test-token"
      },
      signal: expect.any(AbortSignal)
    });
  });

  it("syncs room status with a timeout signal", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(new HttpRoomStatusClient(config).updateRoomStatus("100001", "playing", "owner-1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(new URL("/internal/rooms/100001/status", config.endpoint), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        status: "playing"
      }),
      signal: expect.any(AbortSignal)
    });
  });

  it("claims, refreshes, and releases room claims with timeout signals", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(200, {
          room: {
            id: "room-1",
            code: "100001",
            status: "open",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const client = new HttpRoomStatusClient(config);
    await expect(client.claimRoom("100001", "owner-1", 60_000)).resolves.toBeUndefined();
    await expect(client.refreshRoomClaim("100001", "owner-1", 60_000)).resolves.toBeUndefined();
    await expect(client.releaseRoomClaim("100001", "owner-1", 60_000)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenNthCalledWith(1, new URL("/internal/rooms/100001/claim", config.endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({ ownerId: "owner-1", ttlMs: 60_000 }),
      signal: expect.any(AbortSignal)
    });
    expect(fetch).toHaveBeenNthCalledWith(2, new URL("/internal/rooms/100001/claim", config.endpoint), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({ ownerId: "owner-1", ttlMs: 60_000 }),
      signal: expect.any(AbortSignal)
    });
    expect(fetch).toHaveBeenNthCalledWith(3, new URL("/internal/rooms/100001/claim", config.endpoint), {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({ ownerId: "owner-1", ttlMs: 60_000 }),
      signal: expect.any(AbortSignal)
    });
  });

  it("surfaces API errors when reading room state", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(404, { message: "Room not found." }));

    await expect(new HttpRoomStatusClient(config).getRoomState("100001")).rejects.toThrow(
      "Failed to read state for room 100001: 404 Room not found."
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
            code: "100001",
            status: "open",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          state: null
        })
      );

    await expect(new HttpRoomStatusClient(config).getRoomState("100001")).resolves.toMatchObject({ state: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries room status updates after network failures", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(new HttpRoomStatusClient(config).updateRoomStatus("100001", "closed", "owner-1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed room state responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(200, {
        room: {
          id: "room-1",
          code: "100001",
          status: "playing",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      })
    );

    await expect(new HttpRoomStatusClient(config).getRoomState("100001")).rejects.toThrow(
      "Invalid room state response for 100001"
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
