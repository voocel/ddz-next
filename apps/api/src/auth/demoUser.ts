import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password.js";

export interface DemoUserConfig {
  readonly enabled: boolean;
  readonly nickname: string;
  readonly password: string;
  readonly username: string;
}

export interface DemoUserSeedResult {
  readonly enabled: boolean;
  readonly nickname: string;
  readonly status: "created" | "disabled" | "ready";
  readonly username: string;
  /** 演示账号仍沿用内置默认密码——生产暴露前应换强口令，启动时据此告警（不带出密码本身） */
  readonly usingDefaultPassword: boolean;
}

const DEFAULT_DEMO_USERNAME = "alice";
const DEFAULT_DEMO_NICKNAME = "Alice";
const DEFAULT_DEMO_PASSWORD = "secret123";

export function readDemoUserConfig(env: NodeJS.ProcessEnv = process.env): DemoUserConfig {
  const enabled = readBooleanEnv("DEMO_USER_ENABLED", env.DEMO_USER_ENABLED, false);

  return {
    // 默认关闭，必须显式设置 DEMO_USER_ENABLED=true 才会创建演示账号
    enabled,
    username: readUsername(env.DEMO_USER_USERNAME ?? DEFAULT_DEMO_USERNAME),
    nickname: readNickname(env.DEMO_USER_NICKNAME ?? DEFAULT_DEMO_NICKNAME),
    password: enabled ? readPassword(env.DEMO_USER_PASSWORD ?? DEFAULT_DEMO_PASSWORD) : DEFAULT_DEMO_PASSWORD
  };
}

export async function ensureDemoUser(prisma: PrismaClient, config: DemoUserConfig): Promise<DemoUserSeedResult> {
  const usingDefaultPassword = config.password === DEFAULT_DEMO_PASSWORD;

  if (!config.enabled) {
    return {
      enabled: false,
      username: config.username,
      nickname: config.nickname,
      status: "disabled",
      usingDefaultPassword
    };
  }

  const existing = await prisma.user.findUnique({
    where: {
      username: config.username
    },
    select: {
      id: true
    }
  });

  // 仅在用户不存在时创建，绝不覆盖已存在用户的密码或昵称
  if (existing) {
    return {
      enabled: true,
      username: config.username,
      nickname: config.nickname,
      status: "ready",
      usingDefaultPassword
    };
  }

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
    status: "created",
    usingDefaultPassword
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
