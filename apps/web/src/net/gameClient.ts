import { Client, type Room } from "@colyseus/sdk";
import type { CardId } from "@ddz/domain";
import { DUPLICATE_SESSION_CLOSE_CODE, gameEventSchema, type GameEvent } from "@ddz/protocol";

interface GameClientOptions {
  readonly endpoint: string;
  readonly playerId: string;
  readonly accessToken: string;
  readonly roomCode: string;
  readonly quickStart?: boolean;
  /** 「AI 对战」入口建房时携带:机器人决策来源与模型(provider+model)+ 思考强度;服务端 onCreate 按注册表/档位校验后才生效。 */
  readonly botDecisionMode?: string | undefined;
  readonly botProvider?: string | undefined;
  readonly botModel?: string | undefined;
  readonly botReasoningEffort?: string | undefined;
  readonly onEvent: (event: GameEvent) => void;
  readonly onStatus: (status: string) => void;
  /** 房间被服务端/网络异常关闭（非本地主动离开）时回调 */
  readonly onDropped: (code: number) => void;
}

/** Colyseus 主动离开的正常关闭码 */
const NORMAL_LEAVE_CODE = 1000;
/** 房间内部故障关闭（failRoom disconnect(1011)，DB 已 closed） */
const ROOM_FAILED_CLOSE_CODE = 1011;

/** 该关闭码是否值得自动重连：被踢会与新会话互踢，故障房重试必败 */
export function isRecoverableDropCode(code: number): boolean {
  return code !== DUPLICATE_SESSION_CLOSE_CODE && code !== ROOM_FAILED_CLOSE_CODE;
}

export function createGameClient(options: GameClientOptions) {
  let room: Room | null = null;
  // 世代号：每次 connect/disconnect 自增，旧连接的异步回调据此失效，
  // 避免快速进出房间时旧连接覆盖新状态。
  let generation = 0;
  // 快速开始只在首次入房时自动准备；断线重连回到牌局中再补发会被拒绝
  let quickStartPending = options.quickStart === true;

  const disconnect = (): void => {
    generation += 1;
    room?.leave();
    room = null;
  };

  return {
    /** 返回是否成功入房：断线自动重连需要失败信号决定是否继续重试 */
    async connect(): Promise<boolean> {
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
          roomCode: options.roomCode,
          quickStart: options.quickStart === true,
          ...(options.botDecisionMode ? { botDecisionMode: options.botDecisionMode } : {}),
          ...(options.botProvider ? { botProvider: options.botProvider } : {}),
          ...(options.botModel ? { botModel: options.botModel } : {}),
          ...(options.botReasoningEffort ? { botReasoningEffort: options.botReasoningEffort } : {})
        });
        if (gen !== generation) {
          // 等待期间已被新的 connect/disconnect 取代，丢弃这条旧连接
          void joined.leave();
          return false;
        }

        room = joined;
        // 关闭 SDK 内建的会话级重连：服务器崩溃后旧 roomId 已不存在，按旧会话重试必败；
        // 关闭后异常断开会直接触发 onLeave(code)，由应用层 joinOrCreate 重连（同时覆盖服务端牌局恢复）
        joined.reconnection.enabled = false;
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

        if (quickStartPending) {
          quickStartPending = false;
          joined.send("command", {
            type: "ready"
          });
        }
        return true;
      } catch (error) {
        if (gen !== generation) {
          return false;
        }
        options.onStatus(error instanceof Error ? error.message : "连接失败");
        return false;
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
