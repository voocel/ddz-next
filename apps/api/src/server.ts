import cors from "@fastify/cors";
import {
  createRoomRequestSchema,
  loginRequestSchema,
  recordGameActionRequestSchema,
  registerRequestSchema,
  updateRoomStatusRequestSchema
} from "@ddz/protocol";
import { verifyAccessToken, type AccessTokenClaims, type TokenConfig } from "@ddz/auth";
import { GameActionError } from "./actions/errors.js";
import type { GameActionService } from "./actions/service.js";
import Fastify from "fastify";
import { AuthError } from "./auth/errors.js";
import type { AuthService } from "./auth/service.js";
import { HistoryError } from "./history/errors.js";
import type { HistoryService } from "./history/service.js";
import type { InternalConfig } from "./internal/config.js";
import { RoomError } from "./rooms/errors.js";
import type { RoomService } from "./rooms/service.js";

interface ServerDependencies {
  readonly authService: AuthService;
  readonly roomService: RoomService;
  readonly gameActionService: GameActionService;
  readonly historyService: HistoryService;
  readonly tokenConfig: TokenConfig;
  readonly internalConfig: InternalConfig;
  readonly close?: () => Promise<void>;
}

export function buildServer(dependencies: ServerDependencies) {
  const app = Fastify({
    logger: true
  });

  app.addHook("onClose", async () => {
    await dependencies.close?.();
  });

  app.register(cors, {
    origin: true
  });

  app.get("/health", async () => ({
    ok: true,
    service: "ddz-api"
  }));

  app.post("/auth/register", async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid register request.",
        issues: parsed.error.issues
      });
    }

    try {
      return await dependencies.authService.register(parsed.data);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid login request.",
        issues: parsed.error.issues
      });
    }

    try {
      return await dependencies.authService.login(parsed.data);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get("/rooms", async () => dependencies.roomService.listOpenRooms());

  app.post("/rooms", async (request, reply) => {
    if (!authenticate(request.headers, dependencies.tokenConfig)) {
      return reply.code(401).send({
        message: "Invalid access token."
      });
    }

    const parsed = createRoomRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid create room request.",
        issues: parsed.error.issues
      });
    }

    try {
      return await dependencies.roomService.createRoom(parsed.data);
    } catch (error) {
      return sendRoomError(reply, error);
    }
  });

  app.post("/rooms/match", async (request, reply) => {
    if (!authenticate(request.headers, dependencies.tokenConfig)) {
      return reply.code(401).send({
        message: "Invalid access token."
      });
    }

    try {
      return await dependencies.roomService.matchRoom();
    } catch (error) {
      return sendRoomError(reply, error);
    }
  });

  app.get("/internal/rooms/:code/joinable", async (request, reply) => {
    if (!isInternalRequest(request.headers, dependencies.internalConfig.token)) {
      return reply.code(401).send({
        message: "Invalid internal token."
      });
    }

    const code = (request.params as { code?: string }).code;
    if (!code) {
      return reply.code(400).send({
        message: "Room code is required."
      });
    }

    try {
      return await dependencies.roomService.requireJoinableRoom(code);
    } catch (error) {
      return sendRoomError(reply, error);
    }
  });

  app.get("/me/rounds", async (request, reply) => {
    const claims = authenticate(request.headers, dependencies.tokenConfig);
    if (!claims) {
      return reply.code(401).send({
        message: "Invalid access token."
      });
    }

    try {
      return await dependencies.historyService.listRounds(claims.sub);
    } catch (error) {
      return sendHistoryError(reply, error);
    }
  });

  app.get("/me/rounds/:roundId", async (request, reply) => {
    const claims = authenticate(request.headers, dependencies.tokenConfig);
    if (!claims) {
      return reply.code(401).send({
        message: "Invalid access token."
      });
    }

    const roundId = (request.params as { roundId?: string }).roundId?.trim();
    if (!roundId) {
      return reply.code(400).send({
        message: "Round id is required."
      });
    }

    try {
      return await dependencies.historyService.getRoundReplay(claims.sub, roundId);
    } catch (error) {
      return sendHistoryError(reply, error);
    }
  });

  app.get("/me/coin-ledgers", async (request, reply) => {
    const claims = authenticate(request.headers, dependencies.tokenConfig);
    if (!claims) {
      return reply.code(401).send({
        message: "Invalid access token."
      });
    }

    try {
      return await dependencies.historyService.listCoinLedgers(claims.sub);
    } catch (error) {
      return sendHistoryError(reply, error);
    }
  });

  app.patch("/internal/rooms/:code/status", async (request, reply) => {
    if (!isInternalRequest(request.headers, dependencies.internalConfig.token)) {
      return reply.code(401).send({
        message: "Invalid internal token."
      });
    }

    const code = (request.params as { code?: string }).code;
    if (!code) {
      return reply.code(400).send({
        message: "Room code is required."
      });
    }

    const parsed = updateRoomStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid room status request.",
        issues: parsed.error.issues
      });
    }

    try {
      return await dependencies.roomService.updateRoomStatus(code, parsed.data.status);
    } catch (error) {
      return sendRoomError(reply, error);
    }
  });

  app.post("/internal/game-actions", async (request, reply) => {
    if (!isInternalRequest(request.headers, dependencies.internalConfig.token)) {
      return reply.code(401).send({
        message: "Invalid internal token."
      });
    }

    const parsed = recordGameActionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid game action request.",
        issues: parsed.error.issues
      });
    }

    try {
      return await dependencies.gameActionService.record(parsed.data);
    } catch (error) {
      return sendGameActionError(reply, error);
    }
  });

  return app;
}

function isInternalRequest(headers: Record<string, string | string[] | undefined>, token: string): boolean {
  return headers["x-ddz-internal-token"] === token;
}

function authenticate(headers: Record<string, string | string[] | undefined>, config: TokenConfig): AccessTokenClaims | null {
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

function sendAuthError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      message: error.message
    });
  }

  throw error;
}

function sendRoomError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof RoomError) {
    return reply.code(error.statusCode).send({
      message: error.message
    });
  }

  throw error;
}

function sendGameActionError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof GameActionError) {
    return reply.code(error.statusCode).send({
      message: error.message
    });
  }

  throw error;
}

function sendHistoryError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof HistoryError) {
    return reply.code(error.statusCode).send({
      message: error.message
    });
  }

  throw error;
}
