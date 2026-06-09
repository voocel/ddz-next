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
}

export function createGameClient(options: GameClientOptions) {
  let room: Room | null = null;

  return {
    async connect() {
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
        room = await client.joinOrCreate("ddz", {
          accessToken: options.accessToken,
          roomCode: options.roomCode
        });
        options.onStatus(`已进入房间 ${options.roomCode}`);

        room.onMessage("event", (payload: unknown) => {
          const parsed = gameEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.error("Invalid game event", parsed.error.issues);
            return;
          }
          options.onEvent(parsed.data);
        });

        room.onLeave((code) => {
          options.onStatus(`已离开房间 ${code}`);
        });

        room.onError((code, message) => {
          options.onStatus(`房间错误 ${code}: ${message}`);
        });
      } catch (error) {
        options.onStatus(error instanceof Error ? error.message : "连接失败");
      }
    },
    disconnect() {
      room?.leave();
      room = null;
    },
    leaveRoom() {
      room?.leave();
      room = null;
    },
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
