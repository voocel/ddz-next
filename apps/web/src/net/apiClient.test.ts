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

  it("localizes invalid credential errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid username or password." }), {
        status: 401,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      createApiClient({
        endpoint: "http://api.example"
      }).login({
        username: "alice",
        password: "wrong-password"
      })
    ).rejects.toThrow("用户名或密码错误。");
  });

  it("localizes register field validation errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Invalid register request.",
          issues: [
            {
              code: "too_small",
              minimum: 6,
              path: ["password"]
            }
          ]
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    await expect(
      createApiClient({
        endpoint: "http://api.example"
      }).register({
        username: "alice",
        nickname: "Alice",
        password: "short"
      })
    ).rejects.toThrow("密码至少 6 位。");
  });
});
