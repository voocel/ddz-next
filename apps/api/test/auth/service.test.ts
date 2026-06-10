import { describe, expect, it } from "vitest";
import { verifyAccessToken } from "@ddz/auth";
import { AuthError } from "../../src/auth/errors";
import { AuthService } from "../../src/auth/service";
import { verifyPassword } from "../../src/auth/password";
import { InMemoryUserRepository } from "../helpers";

const tokenConfig = {
  secret: "test-secret-that-is-long-enough",
  issuer: "ddz-api-test",
  audience: "ddz-web-test",
  accessTokenTtlSeconds: 3600
};

describe("AuthService", () => {
  it("registers users with a password hash and issues a verifiable access token", async () => {
    const users = new InMemoryUserRepository();
    const service = new AuthService(users, tokenConfig);

    const response = await service.register({
      username: "Alice",
      nickname: "Alice",
      password: "secret123"
    });

    expect(response.user.username).toBe("alice");
    expect(response.user.nickname).toBe("Alice");
    expect(users.records[0]?.passwordHash).not.toContain("secret123");

    const claims = verifyAccessToken(response.accessToken, tokenConfig);
    expect(claims.sub).toBe(response.user.id);
    expect(claims.username).toBe("alice");
  });

  it("rejects duplicate usernames explicitly", async () => {
    const service = new AuthService(new InMemoryUserRepository(), tokenConfig);

    await service.register({
      username: "alice",
      nickname: "Alice",
      password: "secret123"
    });

    await expect(
      service.register({
        username: "ALICE",
        nickname: "Other",
        password: "secret123"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    } satisfies Partial<AuthError>);
  });

  it("logs in with a valid password and rejects invalid credentials", async () => {
    const service = new AuthService(new InMemoryUserRepository(), tokenConfig);
    await service.register({
      username: "alice",
      nickname: "Alice",
      password: "secret123"
    });

    const login = await service.login({
      username: "alice",
      password: "secret123"
    });
    expect(login.accessToken).toBeTruthy();

    await expect(
      service.login({
        username: "alice",
        password: "wrong-password"
      })
    ).rejects.toMatchObject({
      statusCode: 401
    } satisfies Partial<AuthError>);
  });

  it("rejects usernames with illegal characters", async () => {
    const service = new AuthService(new InMemoryUserRepository(), tokenConfig);

    await expect(
      service.register({
        username: "bad name!",
        nickname: "Bad",
        password: "secret123"
      })
    ).rejects.toMatchObject({
      statusCode: 400
    } satisfies Partial<AuthError>);
  });

  it("rejects unknown usernames with the same error as wrong passwords", async () => {
    const service = new AuthService(new InMemoryUserRepository(), tokenConfig);

    await expect(
      service.login({
        username: "nobody",
        password: "secret123"
      })
    ).rejects.toMatchObject({
      statusCode: 401
    } satisfies Partial<AuthError>);
  });

  it("treats malformed password hashes as verification failure", async () => {
    await expect(verifyPassword("secret123", "not-a-valid-hash")).resolves.toBe(false);
    await expect(verifyPassword("secret123", "scrypt$x$8$1$salt$key")).resolves.toBe(false);
  });
});
