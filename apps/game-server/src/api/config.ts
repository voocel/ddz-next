export interface ApiSyncConfig {
  readonly endpoint: string;
  readonly internalToken: string;
  readonly retryAttempts: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}

const DEFAULT_API_SYNC_RETRY_ATTEMPTS = 3;
const DEFAULT_API_SYNC_RETRY_DELAY_MS = 150;
const DEFAULT_API_SYNC_TIMEOUT_MS = 5_000;

export function readApiSyncConfig(env: NodeJS.ProcessEnv = process.env): ApiSyncConfig {
  const endpoint = env.API_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error("API_ENDPOINT is required to synchronize game room status.");
  }

  const internalToken = env.INTERNAL_API_TOKEN?.trim();
  if (!internalToken) {
    throw new Error("INTERNAL_API_TOKEN is required to synchronize game room status.");
  }

  return {
    endpoint,
    internalToken,
    retryAttempts: readPositiveInteger(env.API_SYNC_RETRY_ATTEMPTS, "API_SYNC_RETRY_ATTEMPTS", DEFAULT_API_SYNC_RETRY_ATTEMPTS),
    retryDelayMs: readNonNegativeInteger(env.API_SYNC_RETRY_DELAY_MS, "API_SYNC_RETRY_DELAY_MS", DEFAULT_API_SYNC_RETRY_DELAY_MS),
    timeoutMs: readTimeoutMs(env.API_SYNC_TIMEOUT_MS)
  };
}

function readTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_API_SYNC_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("API_SYNC_TIMEOUT_MS must be a positive integer in milliseconds.");
  }
  return timeoutMs;
}

function readPositiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}
