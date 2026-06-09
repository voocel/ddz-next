import { PrismaClient } from "@prisma/client";
import type { AuthUserRecord, CreateUserInput, UserRepository } from "./service.js";

const userSelect = {
  id: true,
  username: true,
  nickname: true,
  passwordHash: true
} as const;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUsername(username: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({
      where: {
        username
      },
      select: userSelect
    });
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRecord> {
    return this.prisma.user.create({
      data: {
        username: input.username,
        nickname: input.nickname,
        passwordHash: input.passwordHash
      },
      select: userSelect
    });
  }
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
