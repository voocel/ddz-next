import {
  internalRoomStateResponseSchema,
  roomResponseSchema,
  type InternalRoomStateResponse,
  type RoomDto,
  type RoomStatus
} from "@ddz/protocol";
import type { ApiSyncConfig } from "./config.js";
import { fetchWithRetry } from "./httpRetry.js";

export interface RoomStatusClient {
  createRoom(): Promise<RoomDto>;
  claimRoom(roomCode: string, ownerId: string, ttlMs: number): Promise<void>;
  /** 崩溃恢复查询：房间当前状态 + 最近一次落库的完整牌局状态（无则 null） */
  getRoomState(roomCode: string): Promise<InternalRoomStateResponse>;
  refreshRoomClaim(roomCode: string, ownerId: string, ttlMs: number): Promise<void>;
  releaseRoomClaim(roomCode: string, ownerId: string, ttlMs: number): Promise<void>;
  updateRoomStatus(roomCode: string, status: RoomStatus, ownerId: string): Promise<void>;
}

export class HttpRoomStatusClient implements RoomStatusClient {
  constructor(private readonly config: ApiSyncConfig) {}

  async createRoom(): Promise<RoomDto> {
    const response = await fetchWithRetry(
      new URL("/internal/rooms", this.config.endpoint),
      {
        method: "POST",
        headers: {
          "x-ddz-internal-token": this.config.internalToken
        }
      },
      this.config
    );

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Failed to create matched room: ${response.status} ${formatResponseBody(body)}`);
    }

    const parsed = roomResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `Invalid create room response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
      );
    }

    return parsed.data.room;
  }

  async getRoomState(roomCode: string): Promise<InternalRoomStateResponse> {
    const response = await fetchWithRetry(
      new URL(`/internal/rooms/${roomCode}/state`, this.config.endpoint),
      {
        method: "GET",
        headers: {
          "x-ddz-internal-token": this.config.internalToken
        }
      },
      this.config
    );

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Failed to read state for room ${roomCode}: ${response.status} ${formatResponseBody(body)}`);
    }

    const parsed = internalRoomStateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Invalid room state response for ${roomCode}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }

    return parsed.data;
  }

  async claimRoom(roomCode: string, ownerId: string, ttlMs: number): Promise<void> {
    const response = await fetchWithRetry(
      new URL(`/internal/rooms/${roomCode}/claim`, this.config.endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ddz-internal-token": this.config.internalToken
        },
        body: JSON.stringify({
          ownerId,
          ttlMs
        })
      },
      this.config
    );

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Failed to claim room ${roomCode}: ${response.status} ${formatResponseBody(body)}`);
    }

    const parsed = roomResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Invalid room claim response for ${roomCode}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
  }

  async refreshRoomClaim(roomCode: string, ownerId: string, ttlMs: number): Promise<void> {
    const response = await fetchWithRetry(
      new URL(`/internal/rooms/${roomCode}/claim`, this.config.endpoint),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ddz-internal-token": this.config.internalToken
        },
        body: JSON.stringify({
          ownerId,
          ttlMs
        })
      },
      this.config
    );

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new Error(`Failed to refresh room ${roomCode} claim: ${response.status} ${formatResponseBody(body)}`);
    }
  }

  async releaseRoomClaim(roomCode: string, ownerId: string, ttlMs: number): Promise<void> {
    const response = await fetchWithRetry(
      new URL(`/internal/rooms/${roomCode}/claim`, this.config.endpoint),
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-ddz-internal-token": this.config.internalToken
        },
        body: JSON.stringify({
          ownerId,
          ttlMs
        })
      },
      this.config
    );

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new Error(`Failed to release room ${roomCode} claim: ${response.status} ${formatResponseBody(body)}`);
    }
  }

  async updateRoomStatus(roomCode: string, status: RoomStatus, ownerId: string): Promise<void> {
    const response = await fetchWithRetry(
      new URL(`/internal/rooms/${roomCode}/status`, this.config.endpoint),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ddz-internal-token": this.config.internalToken
        },
        body: JSON.stringify({
          ownerId,
          status
        })
      },
      this.config
    );

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new Error(`Failed to sync room ${roomCode} status to ${status}: ${response.status} ${formatResponseBody(body)}`);
    }
  }

}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return "";
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.trim();
  }
}

function formatResponseBody(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return JSON.stringify(body);
}
