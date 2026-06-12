import type { GameActionType, RoomLiveStateEnvelope } from "@ddz/protocol";
import type { ApiSyncConfig } from "./config.js";

export interface RecordGameActionsInput {
  roomCode: string;
  mutationId: string;
  actions: readonly {
    playerId: string | null;
    playerKind: "human" | "bot" | null;
    type: GameActionType;
    payload: Record<string, unknown>;
  }[];
  /** 崩溃恢复状态，与动作同事务落库 */
  state?: RoomLiveStateEnvelope;
}

export interface GameActionClient {
  recordGameActions(input: RecordGameActionsInput): Promise<void>;
}

export class HttpGameActionClient implements GameActionClient {
  constructor(private readonly config: ApiSyncConfig) {}

  async recordGameActions(input: RecordGameActionsInput): Promise<void> {
    const response = await this.fetchWithRetry(new URL("/internal/game-actions", this.config.endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ddz-internal-token": this.config.internalToken
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const body = (await response.text()).trim();
      throw new Error(`Failed to record ${input.actions.length} actions for room ${input.roomCode}: ${response.status} ${body}`);
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
