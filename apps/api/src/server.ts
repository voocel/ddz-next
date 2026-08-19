import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  createRoomRequestSchema,
  loginRequestSchema,
  recordGameActionRequestSchema,
  registerRequestSchema,
  roomClaimRequestSchema,
  updateRoomStatusRequestSchema
} from "@ddz/protocol";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import { timingSafeEqual } from "node:crypto";
import type { GameActionService } from "./actions/service.js";
import Fastify from "fastify";
import type { AuthService } from "./auth/service.js";
import { ApiError } from "./errors.js";
import type { HistoryService } from "./history/service.js";
import type { InternalConfig } from "./internal/config.js";
import type { LeaderboardService } from "./leaderboard/service.js";
import type { RoomService } from "./rooms/service.js";

interface ServerDependencies {
  readonly authService: AuthService;
  readonly roomService: RoomService;
  readonly gameActionService: GameActionService;
  readonly historyService: HistoryService;
  readonly leaderboardService: LeaderboardService;
  readonly tokenConfig: TokenConfig;
  readonly internalConfig: InternalConfig;
  readonly healthCheck?: () => Promise<void>;
  readonly close?: () => Promise<void>;
}

/** 认证路由限流：同一来源每分钟最多 10 次 */
const authRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute"
    }
  }
};

export function buildServer(dependencies: ServerDependencies) {
  const app = Fastify({
    logger: true
  });

  app.addHook("onClose", async () => {
    await dependencies.close?.();
  });

  app.register(cors, {
    origin: readCorsOrigins()
  });

  app.register(rateLimit, {
    global: false
  });

  // 统一错误处理：ApiError 与 Prisma 已知错误转为对应状态码，其余兜底 500
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(
        error.issues === undefined
          ? { message: error.message }
          : { message: error.message, issues: error.issues }
      );
    }

    const { code, statusCode, message } = error as { code?: unknown; statusCode?: unknown; message?: unknown };
    if (code === "P2002") {
      return reply.code(409).send({ message: "Resource already exists." });
    }
    if (code === "P2025") {
      return reply.code(404).send({ message: "Resource not found." });
    }

    if (typeof statusCode === "number" && statusCode < 500) {
      return reply.code(statusCode).send({ message: typeof message === "string" ? message : "Request failed." });
    }

    request.log.error(error);
    return reply.code(500).send({ message: "Internal server error." });
  });

  app.get("/health", async () => {
    await dependencies.healthCheck?.();
    return {
      ok: true,
      service: "ddz-api"
    };
  });

  // 认证路由需在 rate-limit 插件加载完成后注册，限流配置才会生效
  app.after(() => {
    app.post("/auth/register", authRateLimit, async (request) => {
      const parsed = registerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError("Invalid register request.", 400, parsed.error.issues);
      }

      return dependencies.authService.register(parsed.data);
    });

    app.post("/auth/login", authRateLimit, async (request) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError("Invalid login request.", 400, parsed.error.issues);
      }

      return dependencies.authService.login(parsed.data);
    });
  });

  // 竞技场直播列表（公开）：open/playing 的全 AI 对战房
  app.get("/arena/rooms", async () => dependencies.roomService.listArenaRooms());

  // 模型排行榜（公开）：按 (provider, model) 聚合全部已结束对局
  app.get("/leaderboard", async () => dependencies.leaderboardService.getLeaderboard());

  // 最近的公开 AI 对局（全 bot 已结算局），复盘入口列表
  app.get("/replays/recent", async () => dependencies.historyService.listRecentBotReplays());

  // 公开复盘（仅全 bot 局，明牌下发 revealedHands）；真人局仍走 /me/rounds/:id 私有通道
  app.get("/replays/:roundId", async (request) => {
    const roundId = (request.params as { roundId?: string }).roundId;
    if (!roundId) {
      throw new ApiError("Round id is required.", 400);
    }

    return dependencies.historyService.getPublicRoundReplay(roundId);
  });

  // 公开查房（无牌局状态）：/table/:code、/arena/:code 直连与分享链接的入口
  app.get("/rooms/:code", async (request) => {
    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    return dependencies.roomService.getRoomByCode(code);
  });

  app.post("/rooms", async (request) => {
    requireAuth(request.headers, dependencies.tokenConfig);

    const parsed = createRoomRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ApiError("Invalid create room request.", 400, parsed.error.issues);
    }

    return dependencies.roomService.createRoom(parsed.data);
  });

  // 崩溃恢复查询：state 含手牌，绝不能挪到公开路由
  app.get("/internal/rooms/:code/state", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    return dependencies.roomService.getRoomState(code);
  });

  app.post("/internal/rooms/:code/claim", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    const parsed = roomClaimRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError("Invalid room claim request.", 400, parsed.error.issues);
    }

    return dependencies.roomService.claimRoom(code, parsed.data.ownerId, parsed.data.ttlMs);
  });

  app.patch("/internal/rooms/:code/claim", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    const parsed = roomClaimRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError("Invalid room claim request.", 400, parsed.error.issues);
    }

    await dependencies.roomService.refreshRoomClaim(code, parsed.data.ownerId, parsed.data.ttlMs);
    return { ok: true };
  });

  app.delete("/internal/rooms/:code/claim", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    const parsed = roomClaimRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError("Invalid room claim request.", 400, parsed.error.issues);
    }

    await dependencies.roomService.releaseRoomClaim(code, parsed.data.ownerId);
    return { ok: true };
  });

  app.get("/me/rounds", async (request) => {
    const claims = requireAuth(request.headers, dependencies.tokenConfig);
    return dependencies.historyService.listRounds(claims.sub);
  });

  app.get("/me/rounds/:roundId", async (request) => {
    const claims = requireAuth(request.headers, dependencies.tokenConfig);

    const roundId = (request.params as { roundId?: string }).roundId?.trim();
    if (!roundId) {
      throw new ApiError("Round id is required.", 400);
    }

    return dependencies.historyService.getRoundReplay(claims.sub, roundId);
  });

  app.patch("/internal/rooms/:code/status", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const code = (request.params as { code?: string }).code;
    if (!code) {
      throw new ApiError("Room code is required.", 400);
    }

    const parsed = updateRoomStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError("Invalid room status request.", 400, parsed.error.issues);
    }

    return dependencies.roomService.updateRoomStatus(code, parsed.data.status, parsed.data.ownerId);
  });

  app.post("/internal/game-actions", async (request) => {
    requireInternal(request.headers, dependencies.internalConfig.token);

    const parsed = recordGameActionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError("Invalid game action request.", 400, parsed.error.issues);
    }

    return dependencies.gameActionService.record(parsed.data);
  });

  return app;
}

/** CORS 白名单：从 CORS_ORIGINS 读取（逗号分隔），默认仅允许本地开发前端 */
function readCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

type RequestHeaders = Record<string, string | string[] | undefined>;

function requireInternal(headers: RequestHeaders, token: string): void {
  const header = headers["x-ddz-internal-token"];
  // 常量时间比较，避免内部令牌被时序攻击逐字节猜测
  if (typeof header !== "string" || !constantTimeEquals(header, token)) {
    throw new ApiError("Invalid internal token.", 401);
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireAuth(headers: RequestHeaders, config: TokenConfig): AccessTokenClaims {
  const claims = authenticate(headers, config);
  if (!claims) {
    throw new ApiError("Invalid access token.", 401);
  }
  return claims;
}

function authenticate(headers: RequestHeaders, config: TokenConfig): AccessTokenClaims | null {
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }

  try {
    return verifyAccessToken(authorization.slice("Bearer ".length).trim(), config);
  } catch {
    return null;
  }
}
