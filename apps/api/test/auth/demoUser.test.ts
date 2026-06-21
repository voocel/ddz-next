import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureDemoUser, readDemoUserConfig } from "../../src/auth/demoUser";

describe("demo user seeding", () => {
  it("is disabled by default without explicit opt-in", () => {
    expect(readDemoUserConfig({}).enabled).toBe(false);
    expect(readDemoUserConfig({ NODE_ENV: "development" }).enabled).toBe(false);
    expect(readDemoUserConfig({ DEMO_USER_ENABLED: "true" }).enabled).toBe(true);
  });

  it("allows an empty password when disabled", () => {
    expect(readDemoUserConfig({ DEMO_USER_ENABLED: "false", DEMO_USER_PASSWORD: "" }).enabled).toBe(false);
  });

  it("does nothing when disabled", async () => {
    const prisma = createPrismaMock(null);

    const result = await ensureDemoUser(prisma.client, {
      enabled: false,
      username: "alice",
      nickname: "Alice",
      password: "secret123"
    });

    expect(result.status).toBe("disabled");
    expect(prisma.created).toBe(false);
  });

  it("creates the demo user only when missing", async () => {
    const prisma = createPrismaMock(null);

    const result = await ensureDemoUser(prisma.client, {
      enabled: true,
      username: "alice",
      nickname: "Alice",
      password: "secret123"
    });

    expect(result.status).toBe("created");
    expect(result.usingDefaultPassword).toBe(true);
    expect(prisma.created).toBe(true);
  });

  it("never overwrites an existing user", async () => {
    const prisma = createPrismaMock({ id: "user-1" });

    const result = await ensureDemoUser(prisma.client, {
      enabled: true,
      username: "alice",
      nickname: "Alice",
      password: "another-password"
    });

    expect(result.status).toBe("ready");
    expect(result.usingDefaultPassword).toBe(false);
    expect(prisma.created).toBe(false);
  });
});

function createPrismaMock(existing: { id: string } | null) {
  const state = {
    created: false,
    client: {
      user: {
        async findUnique() {
          return existing;
        },
        async create() {
          state.created = true;
          return { id: "user-new" };
        },
        async update() {
          throw new Error("demo user seeding must never update existing users");
        }
      }
    } as unknown as PrismaClient
  };
  return state;
}
