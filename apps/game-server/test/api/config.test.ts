import { describe, expect, it } from "vitest";
import { readApiSyncConfig } from "../../src/api/config";

describe("readApiSyncConfig", () => {
  it("reads API sync endpoint, token, and default timeout", () => {
    expect(
      readApiSyncConfig({
        API_ENDPOINT: "http://api.test",
        INTERNAL_API_TOKEN: "internal-test-token"
      })
    ).toEqual({
      endpoint: "http://api.test",
      internalToken: "internal-test-token",
      retryAttempts: 3,
      retryDelayMs: 150,
      timeoutMs: 5000
    });
  });

  it("allows API sync timeout and retry policy to be configured", () => {
    expect(
      readApiSyncConfig({
        API_ENDPOINT: "http://api.test",
        API_SYNC_RETRY_ATTEMPTS: "2",
        API_SYNC_RETRY_DELAY_MS: "25",
        API_SYNC_TIMEOUT_MS: "2500",
        INTERNAL_API_TOKEN: "internal-test-token"
      })
    ).toMatchObject({
      retryAttempts: 2,
      retryDelayMs: 25,
      timeoutMs: 2500
    });
  });

  it("rejects invalid API sync timeout values", () => {
    expect(() =>
      readApiSyncConfig({
        API_ENDPOINT: "http://api.test",
        API_SYNC_TIMEOUT_MS: "0",
        INTERNAL_API_TOKEN: "internal-test-token"
      })
    ).toThrow("API_SYNC_TIMEOUT_MS must be a positive integer in milliseconds.");
  });

  it("rejects invalid API sync retry values", () => {
    expect(() =>
      readApiSyncConfig({
        API_ENDPOINT: "http://api.test",
        API_SYNC_RETRY_ATTEMPTS: "0",
        INTERNAL_API_TOKEN: "internal-test-token"
      })
    ).toThrow("API_SYNC_RETRY_ATTEMPTS must be a positive integer.");

    expect(() =>
      readApiSyncConfig({
        API_ENDPOINT: "http://api.test",
        API_SYNC_RETRY_DELAY_MS: "-1",
        INTERNAL_API_TOKEN: "internal-test-token"
      })
    ).toThrow("API_SYNC_RETRY_DELAY_MS must be a non-negative integer.");
  });
});
