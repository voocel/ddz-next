import { Client, type Room } from "@colyseus/sdk";
import type { CardId } from "@ddz/domain";
import { gameEventSchema, type GameEvent } from "@ddz/protocol";

interface GameClientOptions {
  readonly endpoint: string;
  readonly playerId: string;
  readonly accessToken: string;
  readonly roomCode: string;
  readonly onEvent: (event: GameEvent) => void;
  readonly onStatus: (status: string) => void;
  /** 房间被服务端/网络异常关闭（非本地主动离开）时回调 */
  readonly onDropped: (code: number) => void;
}

/** Colyseus 主动离开的正常关闭码 */
const NORMAL_LEAVE_CODE = 1000;

export function createGameClient(options: GameClientOptions) {
  let room: Room | null = null;
  // 世代号：每次 connect/disconnect 自增，旧连接的异步回调据此失效，
  // 避免快速进出房间时旧连接覆盖新状态。
  let generation = 0;

  const disconnect = (): void => {
    generation += 1;
    room?.leave();
    room = null;
  };

  return {
    async connect() {
      const gen = ++generation;
      try {
        if (!options.playerId.trim()) {
          throw new Error("Player id is required before connecting to the game server.");
        }
        if (!options.accessToken.trim()) {
          throw new Error("Access token is required before connecting to the game server.");
        }
        if (!options.roomCode.trim()) {
          throw new Error("Room code is required before connecting to the game server.");
        }

        options.onStatus("连接中");
        const client = new Client(options.endpoint);
        const joined = await client.joinOrCreate("ddz", {
          accessToken: options.accessToken,
          roomCode: options.roomCode
        });
        if (gen !== generation) {
          // 等待期间已被新的 connect/disconnect 取代，丢弃这条旧连接
          void joined.leave();
          return;
        }

        room = joined;
        options.onStatus(`已进入房间 ${options.roomCode}`);

        joined.onMessage("event", (payload: unknown) => {
          if (gen !== generation) {
            return;
          }
          const parsed = gameEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.error("Invalid game event", parsed.error.issues);
            return;
          }
          options.onEvent(parsed.data);
        });

        joined.onLeave((code) => {
          if (gen !== generation) {
            return;
          }
          // 走到这里说明不是本地 disconnect 触发（disconnect 会先自增世代号）
          generation += 1;
          room = null;
          if (code === NORMAL_LEAVE_CODE) {
            options.onStatus(`已离开房间 ${code}`);
            return;
          }
          options.onDropped(code);
        });

        joined.onError((code, message) => {
          if (gen !== generation) {
            return;
          }
          options.onStatus(`房间错误 ${code}: ${message}`);
        });
      } catch (error) {
        if (gen !== generation) {
          return;
        }
        options.onStatus(error instanceof Error ? error.message : "连接失败");
      }
    },
    disconnect,
    ready() {
      room?.send("command", {
        type: "ready"
      });
    },
    bidLandlord(called: boolean) {
      room?.send("command", {
        type: "bid_landlord",
        called
      });
    },
    robLandlord(robbed: boolean) {
      room?.send("command", {
        type: "rob_landlord",
        robbed
      });
    },
    pass() {
      room?.send("command", {
        type: "pass"
      });
    },
    playCards(cards: readonly CardId[]) {
      room?.send("command", {
        type: "play_cards",
        cards
      });
    }
  };
}
