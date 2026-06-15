import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpGameActionClient } from "../../src/api/gameActionClient";

const config = {
  endpoint: "http://api.test",
  internalToken: "internal-test-token",
  retryAttempts: 3,
  retryDelayMs: 0,
  timeoutMs: 5000
};

describe("HttpGameActionClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records game actions with a timeout signal", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(
      new HttpGameActionClient(config).recordGameActions({
        roomCode: "100001",
        mutationId: "00000000-0000-4000-8000-000000000001",
        actions: [
          {
            playerId: "p0",
            playerKind: "human",
            type: "player_ready",
            payload: {}
          }
        ]
      })
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(new URL("/internal/game-actions", config.endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": "internal-test-token"
      },
      body: JSON.stringify({
        roomCode: "100001",
        mutationId: "00000000-0000-4000-8000-000000000001",
        actions: [
          {
            playerId: "p0",
            playerKind: "human",
            type: "player_ready",
            payload: {}
          }
        ]
      }),
      signal: expect.any(AbortSignal)
    });
  });

  it("rejects failed API responses", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("retry 1", { status: 500 }))
      .mockResolvedValueOnce(new Response("retry 2", { status: 500 }))
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await expect(
      new HttpGameActionClient(config).recordGameActions({
        roomCode: "100001",
        mutationId: "00000000-0000-4000-8000-000000000002",
        actions: []
      })
    ).rejects.toThrow("Failed to record 0 actions for room 100001: 500 nope");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries game action writes after retryable API failures", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(
      new HttpGameActionClient(config).recordGameActions({
        roomCode: "100001",
        mutationId: "00000000-0000-4000-8000-000000000003",
        actions: [
          {
            playerId: "p0",
            playerKind: "human",
            type: "player_ready",
            payload: {}
          }
        ]
      })
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
