import type { GameActionType, RoomLiveStateEnvelope } from "@ddz/protocol";
import type { ApiSyncConfig } from "./config.js";
import { fetchWithRetry } from "./httpRetry.js";

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
    const response = await fetchWithRetry(
      new URL("/internal/game-actions", this.config.endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ddz-internal-token": this.config.internalToken
        },
        body: JSON.stringify(input)
      },
      this.config
    );

    if (!response.ok) {
      const body = (await response.text()).trim();
      throw new Error(`Failed to record ${input.actions.length} actions for room ${input.roomCode}: ${response.status} ${body}`);
    }
  }
}
