import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { readTokenConfig } from "@ddz/auth";
import { loadRootEnv } from "@ddz/env";
import { listModels } from "@ddz/bot-ai";
import { loadBotProviderRegistry } from "./botProviders.js";
import { readApiSyncConfig } from "./api/config.js";
import { HttpGameActionClient } from "./api/gameActionClient.js";
import { HttpRoomStatusClient } from "./api/roomStatusClient.js";
import { DdzRoom } from "./rooms/DdzRoom.js";
import { MatchmakingRoom } from "./rooms/MatchmakingRoom.js";

/** /bot-models 路由只用到 express Response 的这两个方法,结构化标注避免引入 @types/express。 */
interface ExpressJsonResponse {
  set(field: string, value: string): unknown;
  json(body: unknown): unknown;
}

loadRootEnv();

const port = Number(process.env.GAME_PORT ?? 2567);
const tokenConfig = readTokenConfig();
const apiSyncConfig = readApiSyncConfig();
const botCount = readIntegerEnv("BOT_COUNT", 0, {
  min: 0,
  max: 2
});
// 不设置时走 botTiming 的拟真区间(默认);设置则固定该延迟,供测试/CI 压成极小值
const botMoveDelayMs = readOptionalIntegerEnv("BOT_MOVE_DELAY_MS", { min: 0 });
const turnTimeoutMs = readIntegerEnv("TURN_TIMEOUT_MS", 20_000, {
  min: 1
});
// 机器人供应商注册表(含密钥,仅服务端):BOT_PROVIDERS 内联 JSON 优先,否则读 bot-providers.json,
// 都没有则按 ANTHROPIC_API_KEY 合成默认 anthropic。配置写错会在启动时显式抛错。
const botRegistry = loadBotProviderRegistry();
const roomStatusClient = new HttpRoomStatusClient(apiSyncConfig);
const gameActionClient = new HttpGameActionClient(apiSyncConfig);
const gameServer = new Server({
  transport: new WebSocketTransport(),
  // 下发可选机器人模型清单(无密钥)给前端「AI 对战」下拉;public 数据,允许跨源 GET。
  // express/@types/express 非直接依赖,handler 用结构化类型标注,避免引入额外依赖。
  express: (app) => {
    app.get("/bot-models", (_req: unknown, res: ExpressJsonResponse) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.json({ default: botRegistry.default, models: listModels(botRegistry) });
    });
  }
});

// static onAuth 在房间创建前就会执行，token 配置需在进程启动时注入
DdzRoom.authTokenConfig = tokenConfig;
MatchmakingRoom.authTokenConfig = tokenConfig;

gameServer.define("ddz", DdzRoom, {
  roomStatusClient,
  gameActionClient,
  botCount,
  botMoveDelayMs,
  turnTimeoutMs,
  botRegistry
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

/** 与 readIntegerEnv 同校验,但未设置时返回 undefined(交由下游决定默认行为) */
function readOptionalIntegerEnv(name: string, limits: { readonly max?: number; readonly min: number }): number | undefined {
  if (process.env[name] === undefined || process.env[name]?.trim() === "") {
    return undefined;
  }
  return readIntegerEnv(name, 0, limits);
}
