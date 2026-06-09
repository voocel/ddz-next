import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send a JSON content-type for empty POST requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room: {
            id: "room-1",
            code: "ABCD",
            status: "open",
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:00.000Z"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    await createApiClient({
      endpoint: "http://api.example"
    }).matchRoom("token-1");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({
      authorization: "Bearer token-1"
    });
  });
});
