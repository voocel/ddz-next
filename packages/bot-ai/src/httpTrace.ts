import { AsyncLocalStorage } from "node:async_hooks";

export interface LlmHttpTraceRequest {
  readonly method: string | null;
  readonly headers: Record<string, string> | null;
  readonly body: string | null;
}

export interface LlmHttpTraceResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  /** 上游原始响应体,不截断。 */
  readonly body: string | null;
  readonly bodyLength: number | null;
}

export interface LlmHttpTraceEntry {
  readonly provider: string;
  readonly model: string;
  readonly url: string;
  readonly request: LlmHttpTraceRequest;
  response: LlmHttpTraceResponse | null;
  responseReadError: string | null;
  error: string | null;
  latencyMs: number | null;
}

export interface LlmHttpTrace {
  readonly requests: readonly LlmHttpTraceEntry[];
}

interface LlmHttpTraceScope {
  readonly entries: LlmHttpTraceEntry[];
  readonly pending: Promise<void>[];
}

const storage = new AsyncLocalStorage<LlmHttpTraceScope>();

export function createLlmHttpTraceScope(): LlmHttpTraceScope {
  return { entries: [], pending: [] };
}

export function runWithLlmHttpTraceScope<T>(scope: LlmHttpTraceScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export async function finishLlmHttpTraceScope(scope: LlmHttpTraceScope): Promise<LlmHttpTrace | null> {
  await Promise.allSettled(scope.pending);
  return scope.entries.length > 0 ? { requests: scope.entries } : null;
}

export function currentLlmHttpTraceScope(): LlmHttpTraceScope | null {
  return storage.getStore() ?? null;
}
