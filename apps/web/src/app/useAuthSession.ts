import { useCallback, useMemo, useState, type FormEvent } from "react";
import type { LoginResponse } from "@ddz/protocol";
import { createApiClient } from "../net/apiClient";
import { clearStoredSession, readStoredSession, storeSession } from "./sessionStorage";
import type { AuthMode } from "./types";

type AuthStatusTone = "idle" | "loading" | "success" | "error";

/**
 * 账号与会话域：登录态、API 客户端、登录/注册表单与提交、登出。
 * api 的 onUnauthorized 与 logout 都只置空 session；房间/战绩等下游状态由各自的 hook 监听 session 自行清理。
 */
export function useAuthSession() {
  const [session, setSession] = useState<LoginResponse | null>(() => readStoredSession());
  const [authStatus, setAuthStatus] = useState(() => (session ? `已登录 ${session.user.nickname}` : "未登录"));
  const [authStatusTone, setAuthStatusTone] = useState<AuthStatusTone>(() => (session ? "success" : "idle"));
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  // 开发模式预填演示账号（与 API 的 DEMO_USER_ENABLED 演示用户对应），生产构建保持为空
  const [username, setUsername] = useState(import.meta.env.DEV ? "alice" : "");
  const [nickname, setNickname] = useState(import.meta.env.DEV ? "Alice" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "secret123" : "");

  const api = useMemo(
    () =>
      createApiClient({
        endpoint: import.meta.env.VITE_API_ENDPOINT ?? "http://localhost:3000",
        onUnauthorized: () => {
          // 令牌失效：清会话回登录屏
          setSession(null);
          clearStoredSession();
          setAuthStatus("登录已过期，请重新登录");
          setAuthStatusTone("error");
        }
      }),
    []
  );

  const submitAuth = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setAuthStatus(authMode === "login" ? "正在登录..." : "正在注册...");
      setAuthStatusTone("loading");

      try {
        const response =
          authMode === "login"
            ? await api.login({
                username,
                password
              })
            : await api.register({
                username,
                nickname,
                password
              });
        setSession(response);
        storeSession(response);
        setAuthStatus(`已登录 ${response.user.nickname}`);
        setAuthStatusTone("success");
      } catch (error) {
        setSession(null);
        clearStoredSession();
        setAuthStatus(error instanceof Error ? error.message : authMode === "login" ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。");
        setAuthStatusTone("error");
      }
    },
    [api, authMode, nickname, password, username]
  );

  const logout = useCallback((): void => {
    // 断线与下游状态清理由各 hook 的 session 副作用统一处理
    setSession(null);
    clearStoredSession();
    setAuthStatus("未登录");
    setAuthStatusTone("idle");
  }, []);

  return {
    session,
    api,
    username,
    setUsername,
    nickname,
    setNickname,
    password,
    setPassword,
    authMode,
    setAuthMode,
    authStatus,
    authStatusTone,
    submitAuth,
    logout
  };
}
