import type { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "./password.js";

export interface DemoUserConfig {
  readonly enabled: boolean;
  readonly nickname: string;
  readonly password: string;
  readonly username: string;
}

export interface DemoUserSeedResult {
  readonly enabled: boolean;
  readonly nickname: string;
  readonly status: "created" | "disabled" | "ready" | "updated";
  readonly username: string;
}

const DEFAULT_DEMO_USERNAME = "alice";
const DEFAULT_DEMO_NICKNAME = "Alice";
const DEFAULT_DEMO_PASSWORD = "secret123";

export function readDemoUserConfig(env: NodeJS.ProcessEnv = process.env): DemoUserConfig {
  return {
    enabled: readBooleanEnv("DEMO_USER_ENABLED", env.DEMO_USER_ENABLED, env.NODE_ENV !== "production"),
    username: readUsername(env.DEMO_USER_USERNAME ?? DEFAULT_DEMO_USERNAME),
    nickname: readNickname(env.DEMO_USER_NICKNAME ?? DEFAULT_DEMO_NICKNAME),
    password: readPassword(env.DEMO_USER_PASSWORD ?? DEFAULT_DEMO_PASSWORD)
  };
}

export async function ensureDemoUser(prisma: PrismaClient, config: DemoUserConfig): Promise<DemoUserSeedResult> {
  if (!config.enabled) {
    return {
      enabled: false,
      username: config.username,
      nickname: config.nickname,
      status: "disabled"
    };
  }

  const existing = await prisma.user.findUnique({
    where: {
      username: config.username
    },
    select: {
      id: true,
      nickname: true,
      passwordHash: true
    }
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: config.username,
        nickname: config.nickname,
        passwordHash: await hashPassword(config.password)
      }
    });
    return {
      enabled: true,
      username: config.username,
      nickname: config.nickname,
      status: "created"
    };
  }

  const passwordMatches = await verifyPassword(config.password, existing.passwordHash);
  if (passwordMatches && existing.nickname === config.nickname) {
    return {
      enabled: true,
      username: config.username,
      nickname: config.nickname,
      status: "ready"
    };
  }

  await prisma.user.update({
    where: {
      id: existing.id
    },
    data: {
      nickname: config.nickname,
      passwordHash: passwordMatches ? existing.passwordHash : await hashPassword(config.password)
    }
  });

  return {
    enabled: true,
    username: config.username,
    nickname: config.nickname,
    status: "updated"
  };
}

function readBooleanEnv(name: string, raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function readUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new Error("DEMO_USER_USERNAME must be 3-32 lowercase letters, numbers, underscores, or hyphens.");
  }
  return username;
}

function readNickname(value: string): string {
  const nickname = value.trim();
  if (nickname.length < 1 || nickname.length > 32) {
    throw new Error("DEMO_USER_NICKNAME must be 1-32 characters.");
  }
  return nickname;
}

function readPassword(value: string): string {
  if (value.length < 6 || value.length > 128) {
    throw new Error("DEMO_USER_PASSWORD must be 6-128 characters.");
  }
  return value;
}
