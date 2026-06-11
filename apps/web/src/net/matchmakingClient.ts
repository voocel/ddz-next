import { Client, type Room } from "@colyseus/sdk";
import { matchmakingEventSchema, type MatchmakingEvent } from "@ddz/protocol";

interface MatchmakingClientOptions {
  readonly endpoint: string;
  readonly accessToken: string;
  readonly onEvent: (event: MatchmakingEvent) => void;
  readonly onStatus: (status: string) => void;
  /** 匹配通道断开（被踢/网络异常）时回调，上层清理排队状态 */
  readonly onClosed: () => void;
}

export function createMatchmakingClient(options: MatchmakingClientOptions) {
  let room: Room | null = null;
  // 与 gameClient 相同的世代号机制：cancel 后旧连接的回调全部失效
  let generation = 0;

  return {
    async start() {
      const gen = ++generation;
      try {
        if (!options.accessToken.trim()) {
          throw new Error("Access token is required before matchmaking.");
        }

        const client = new Client(options.endpoint);
        const joined = await client.joinOrCreate("matchmaking", {
          accessToken: options.accessToken
        });
        if (gen !== generation) {
          void joined.leave();
          return;
        }

        room = joined;
        joined.onMessage("matchmaking", (payload: unknown) => {
          if (gen !== generation) {
            return;
          }
          const parsed = matchmakingEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.error("Invalid matchmaking event", parsed.error.issues);
            return;
          }
          options.onEvent(parsed.data);
        });

        joined.onLeave(() => {
          if (gen !== generation) {
            return;
          }
          generation += 1;
          room = null;
          options.onClosed();
        });
      } catch (error) {
        if (gen !== generation) {
          return;
        }
        options.onStatus(error instanceof Error ? error.message : "进入匹配队列失败");
        options.onClosed();
      }
    },
    cancel() {
      generation += 1;
      room?.leave();
      room = null;
    }
  };
}
