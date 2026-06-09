import { AuthService } from "./service.js";
import { readTokenConfig } from "./config.js";
import { createPrismaClient, PrismaUserRepository } from "./prismaUserRepository.js";
import { ensureDemoUser, readDemoUserConfig, type DemoUserSeedResult } from "./demoUser.js";
import { PrismaRoomRepository } from "../rooms/prismaRoomRepository.js";
import { RoomService } from "../rooms/service.js";
import { readInternalConfig, type InternalConfig } from "../internal/config.js";
import { PrismaGameActionRepository } from "../actions/prismaGameActionRepository.js";
import { GameActionService } from "../actions/service.js";
import { PrismaHistoryRepository } from "../history/prismaHistoryRepository.js";
import { HistoryService } from "../history/service.js";

export interface DefaultAuthDependencies {
  readonly authService: AuthService;
  readonly roomService: RoomService;
  readonly gameActionService: GameActionService;
  readonly historyService: HistoryService;
  readonly tokenConfig: ReturnType<typeof readTokenConfig>;
  readonly internalConfig: InternalConfig;
  ensureDemoUser(): Promise<DemoUserSeedResult>;
  close(): Promise<void>;
}

export function createDefaultAuthDependencies(): DefaultAuthDependencies {
  const prisma = createPrismaClient();
  const tokenConfig = readTokenConfig();

  return {
    authService: new AuthService(new PrismaUserRepository(prisma), tokenConfig),
    roomService: new RoomService(new PrismaRoomRepository(prisma)),
    gameActionService: new GameActionService(new PrismaGameActionRepository(prisma)),
    historyService: new HistoryService(new PrismaHistoryRepository(prisma)),
    tokenConfig,
    internalConfig: readInternalConfig(),
    ensureDemoUser: () => ensureDemoUser(prisma, readDemoUserConfig()),
    close: () => prisma.$disconnect()
  };
}
