import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { readApiSyncConfig } from "./api/config.js";
import { HttpGameActionClient } from "./api/gameActionClient.js";
import { HttpRoomStatusClient } from "./api/roomStatusClient.js";
import { readTokenConfig } from "./auth/config.js";
import { loadRootEnv } from "./env.js";
import { DdzRoom } from "./rooms/DdzRoom.js";

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

gameServer.define("ddz", DdzRoom, {
  tokenConfig,
  roomStatusClient,
  gameActionClient,
  botCount,
  botMoveDelayMs,
  turnTimeoutMs
}).filterBy(["roomCode"]);

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
