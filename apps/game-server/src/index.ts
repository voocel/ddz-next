import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { readTokenConfig } from "@ddz/auth";
import { loadRootEnv } from "@ddz/env";
import { readApiSyncConfig } from "./api/config.js";
import { HttpGameActionClient } from "./api/gameActionClient.js";
import { HttpRoomStatusClient } from "./api/roomStatusClient.js";
import { DdzRoom } from "./rooms/DdzRoom.js";
import { MatchmakingRoom } from "./rooms/MatchmakingRoom.js";

loadRootEnv();

const port = Number(process.env.GAME_PORT ?? 2567);
const tokenConfig = readTokenConfig();
const apiSyncConfig = readApiSyncConfig();
const botCount = readIntegerEnv("BOT_COUNT", 0, {
  min: 0,
  max: 2
});
const botMoveDelayMs = readIntegerEnv("BOT_MOVE_DELAY_MS", 500, {
  min: 0
});
const turnTimeoutMs = readIntegerEnv("TURN_TIMEOUT_MS", 20_000, {
  min: 1
});
const roomStatusClient = new HttpRoomStatusClient(apiSyncConfig);
const gameActionClient = new HttpGameActionClient(apiSyncConfig);
const gameServer = new Server({
  transport: new WebSocketTransport()
});

// static onAuth 在房间创建前就会执行，token 配置需在进程启动时注入
DdzRoom.authTokenConfig = tokenConfig;
MatchmakingRoom.authTokenConfig = tokenConfig;

gameServer.define("ddz", DdzRoom, {
  roomStatusClient,
  gameActionClient,
  botCount,
  botMoveDelayMs,
  turnTimeoutMs
}).filterBy(["roomCode"]);

gameServer.define("matchmaking", MatchmakingRoom, {
  roomStatusClient,
  matchTimeoutMs: readIntegerEnv("MATCH_TIMEOUT_MS", 8_000, {
    min: 1000
  })
});

await gameServer.listen(port);

console.log(`DDZ game server listening on http://localhost:${port}`);

function readIntegerEnv(
  name: string,
  defaultValue: number,
  limits: {
    readonly max?: number;
    readonly min: number;
  }
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < limits.min || (limits.max !== undefined && value > limits.max)) {
    const maxText = limits.max === undefined ? "" : ` and at most ${limits.max}`;
    throw new Error(`${name} must be an integer at least ${limits.min}${maxText}.`);
  }

  return value;
}
