import { loadRootEnv } from "./env.js";
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
