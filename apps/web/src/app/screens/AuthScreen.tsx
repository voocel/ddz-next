import { themeAsset, type ThemeId } from "../../theme";
import type { AuthSession } from "../useAuthSession";

export function AuthScreen({ auth, theme }: { readonly auth: AuthSession; readonly theme: ThemeId }) {
  const {
    authMode,
    authStatus,
    authStatusTone,
    username,
    setUsername,
    nickname,
    setNickname,
    password,
    setPassword,
    setAuthMode,
    submitAuth
  } = auth;

  return (
    <main className="auth-screen">
      <img className="auth-mascot mascot-left" src={themeAsset(theme, "mascot_left.png")} alt="" />
      <img className="auth-mascot mascot-right" src={themeAsset(theme, "mascot_right.png")} alt="" />
      <section className="auth-card">
        <img className="auth-logo" src="/assets/images/hall_logo_hd.png" alt="斗地主" />
        <form className="auth-form" onSubmit={submitAuth}>
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如 alice"
              minLength={3}
              maxLength={32}
              autoComplete="username"
              required
            />
          </label>
          {authMode === "register" ? (
            <label>
              昵称
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="例如 Alice"
                minLength={1}
                maxLength={32}
                autoComplete="nickname"
                required
              />
            </label>
          ) : null}
          <label>
            密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="至少 6 位"
              minLength={6}
              maxLength={128}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          <div className="auth-actions">
            <button type="submit" className="btn-img btn-img-orange btn-img-lg">
              {authMode === "login" ? "开始游戏" : "注册并登录"}
            </button>
            <button
              type="button"
              className="btn-img btn-img-green"
              onClick={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
            >
              {authMode === "login" ? "注册新账号" : "返回登录"}
            </button>
          </div>
          <p className={`form-status form-status-${authStatusTone}`} aria-live="polite">
            {authStatus}
          </p>
        </form>
      </section>
    </main>
  );
}
