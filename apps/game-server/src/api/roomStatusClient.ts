import { internalRoomJoinResponseSchema, roomResponseSchema, type RoomDto, type RoomStatus } from "@ddz/protocol";
import type { ApiSyncConfig } from "./config.js";

export interface RoomStatusClient {
  createRoom(): Promise<RoomDto>;
  requireJoinableRoom(roomCode: string): Promise<void>;
  updateRoomStatus(roomCode: string, status: RoomStatus): Promise<void>;
}

export class HttpRoomStatusClient implements RoomStatusClient {
  constructor(private readonly config: ApiSyncConfig) {}

  async createRoom(): Promise<RoomDto> {
    const response = await this.fetchWithRetry(new URL("/internal/rooms", this.config.endpoint), {
      method: "POST",
      headers: {
        "x-ddz-internal-token": this.config.internalToken
      }
    });

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

  async requireJoinableRoom(roomCode: string): Promise<void> {
    const response = await this.fetchWithRetry(new URL(`/internal/rooms/${roomCode}/joinable`, this.config.endpoint), {
      method: "GET",
      headers: {
        "x-ddz-internal-token": this.config.internalToken
      }
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Room ${roomCode} is not joinable: ${response.status} ${formatResponseBody(body)}`);
    }

    const parsed = internalRoomJoinResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Invalid joinable room response for ${roomCode}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }

    if (parsed.data.room.code !== roomCode || parsed.data.room.status !== "open") {
      throw new Error(`Room ${roomCode} joinability response does not match the requested open room.`);
    }
  }

  async updateRoomStatus(roomCode: string, status: RoomStatus): Promise<void> {
    const response = await this.fetchWithRetry(new URL(`/internal/rooms/${roomCode}/status`, this.config.endpoint), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": this.config.internalToken
      },
      body: JSON.stringify({
        status
      })
    });

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new Error(`Failed to sync room ${roomCode} status to ${status}: ${response.status} ${formatResponseBody(body)}`);
    }
  }

  private async fetchWithRetry(url: URL, init: RequestInit): Promise<Response> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.config.timeoutMs)
        });
        if (!isRetryableResponse(response) || attempt === this.config.retryAttempts) {
          return response;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt === this.config.retryAttempts) {
          throw error;
        }
      }

      await delay(this.config.retryDelayMs * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error("API request failed.");
  }
}

function isRetryableResponse(response: Response): boolean {
  return response.status >= 500;
}

function delay(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
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
