import net from "node:net";

const apiEndpoint = readUrlEnv("SMOKE_API_ENDPOINT", process.env.API_ENDPOINT ?? "http://localhost:3000");
const gameEndpoint = readUrlEnv("SMOKE_GAME_ENDPOINT", process.env.GAME_ENDPOINT ?? "http://localhost:2567");
const databaseUrl = readUrlEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://postgres:123456@localhost:5433/ddz");

async function main(): Promise<void> {
  const results = await Promise.allSettled([
    checkTcp("PostgreSQL", databaseUrl),
    checkApiHealth(),
    checkTcp("Game Server", gameEndpoint)
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => formatUnknownError(result.reason));

  if (failures.length > 0) {
    throw new Error(`Smoke preflight failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiEndpoint,
        gameEndpoint,
        databaseHost: redactCredentials(databaseUrl)
      },
      null,
      2
    )
  );
}

async function checkApiHealth(): Promise<void> {
  const url = new URL("/health", apiEndpoint);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`API is not reachable at ${url.toString()}: ${formatUnknownError(error)}`, {
      cause: error
    });
  }

  if (!response.ok) {
    throw new Error(`API health check failed at ${url.toString()}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
    throw new Error(`API health check returned an invalid body from ${url.toString()}.`);
  }
}

async function checkTcp(label: string, endpoint: string): Promise<void> {
  const url = new URL(endpoint);
  const port = readPort(url);
  const host = url.hostname;

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({
      host,
      port
    });
    socket.setTimeout(readPositiveIntegerEnv("SMOKE_PREFLIGHT_TCP_TIMEOUT_MS", 2_000));
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${label} is not reachable at ${host}:${port}: connection timed out.`));
    });
    socket.once("error", (error) => {
      reject(new Error(`${label} is not reachable at ${host}:${port}: ${formatUnknownError(error)}`, { cause: error }));
    });
  });
}

function readUrlEnv(name: string, value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function readPort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }

  if (url.protocol === "https:" || url.protocol === "wss:") {
    return 443;
  }

  if (url.protocol === "http:" || url.protocol === "ws:") {
    return 80;
  }

  if (url.protocol === "postgresql:" || url.protocol === "postgres:") {
    return 5432;
  }

  throw new Error(`Cannot infer TCP port for protocol ${url.protocol}`);
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function redactCredentials(value: string): string {
  const url = new URL(value);
  url.username = url.username ? "****" : "";
  url.password = url.password ? "****" : "";
  return url.toString();
}

function formatUnknownError(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map(formatUnknownError).filter(Boolean);
    if (error.message && messages.length > 0) {
      return `${error.message}: ${messages.join("; ")}`;
    }
    if (messages.length > 0) {
      return messages.join("; ");
    }
    return error.message || error.name;
  }

  return error instanceof Error ? error.message : String(error);
}

await main();
