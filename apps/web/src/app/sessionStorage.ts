import { loginResponseSchema, type LoginResponse } from "@ddz/protocol";

const SESSION_STORAGE_KEY = "ddz.session";

export function readStoredSession(): LoginResponse | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = loginResponseSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Bad localStorage data is not recoverable; remove it and continue logged out.
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  return null;
}

export function storeSession(session: LoginResponse): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
