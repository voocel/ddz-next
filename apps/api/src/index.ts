import { loadRootEnv } from "@ddz/env";
import { buildServer } from "./server.js";
import { createDefaultAuthDependencies } from "./auth/defaults.js";

loadRootEnv();

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? "127.0.0.1";
const dependencies = createDefaultAuthDependencies();
const demoUser = await dependencies.ensureDemoUser();
const server = buildServer(dependencies);

await server.listen({
  port,
  host
});

if (demoUser.enabled) {
  server.log.info(
    {
      username: demoUser.username,
      nickname: demoUser.nickname,
      status: demoUser.status
    },
    "Demo user is available."
  );
}

// 空房清扫：open 状态长期无活动（无人加入/游戏服宕机残留）的房间定期收尾为 closed
const ROOM_SWEEP_INTERVAL_MS = 5 * 60_000;
const ROOM_MAX_IDLE_MS = 15 * 60_000;
const sweepTimer = setInterval(() => {
  void dependencies.roomService
    .closeStaleRooms(ROOM_MAX_IDLE_MS)
    .then((count) => {
      if (count > 0) {
        server.log.info({ count }, "Closed stale open rooms.");
      }
    })
    .catch((error) => {
      server.log.error(error, "Failed to sweep stale rooms.");
    });
}, ROOM_SWEEP_INTERVAL_MS);
// unref：清扫定时器不阻止进程退出，停机时无需显式清理
sweepTimer.unref();

// 优雅停机：关闭 HTTP 服务（onClose 钩子内会断开 Prisma 连接）
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    server.log.info({ signal }, "Shutting down.");
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      server.log.error(error, "Failed to shut down gracefully.");
      process.exit(1);
    }
  });
}
