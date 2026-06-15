import type { ApiSyncConfig } from "./config.js";

/**
 * 带退避重试的 fetch：5xx 响应与网络错误按 config.retryAttempts 次重试、延迟随次数递增。
 * game-server 访问 api 内部通道的各客户端共用此实现。
 */
export async function fetchWithRetry(url: URL, init: RequestInit, config: ApiSyncConfig): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      if (!isRetryableResponse(response) || attempt === config.retryAttempts) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === config.retryAttempts) {
        throw error;
      }
    }

    await delay(config.retryDelayMs * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("API request failed.");
}

function isRetryableResponse(response: Response): boolean {
  return response.status >= 500;
}

function delay(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
