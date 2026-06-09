import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "../src";

const config = {
  secret: "test-secret-that-is-long-enough",
  issuer: "ddz-api-test",
  audience: "ddz-web-test",
  accessTokenTtlSeconds: 3600
};

describe("access tokens", () => {
  it("signs and verifies access token claims", () => {
    const token = signAccessToken(
      {
        id: "user-1",
        username: "alice",
        nickname: "Alice"
      },
      config
    );

    const claims = verifyAccessToken(token, config);
    expect(claims.sub).toBe("user-1");
    expect(claims.username).toBe("alice");
    expect(claims.nickname).toBe("Alice");
  });

  it("rejects tokens with a different audience", () => {
    const token = signAccessToken(
      {
        id: "user-1",
        username: "alice",
        nickname: "Alice"
      },
      config
    );

    expect(() =>
      verifyAccessToken(token, {
        ...config,
        audience: "other"
      })
    ).toThrow("Access token issuer or audience does not match.");
  });
});
