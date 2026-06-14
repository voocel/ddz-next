import React, { Suspense, lazy, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatDateTime, formatDelta, formatRoundDelta } from "./app/formatters";
import { useDdzApp } from "./app/useDdzApp";
import { useTurnAlarm } from "./app/useTurnAlarm";
import type { PhaserTableHandle } from "./PhaserTable";
import { avatarAsset, nextTheme, themeAsset, themeLabel, type ThemeId } from "./theme";
import "./styles.css";

const PhaserTable = lazy(async () => {
  const module = await import("./PhaserTable");
  return {
    default: module.PhaserTable
  };
});

type LobbyModalKind = "history" | "ledger" | "replay";

/** 牌桌闹钟：嵌在控制行中间，秒数叠在主题闹钟素材上；≤5 秒变红，本地玩家回合时摇铃 */
function TurnClock({ theme, remainingMs, local }: { theme: ThemeId; remainingMs: number; local: boolean }) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const low = seconds <= 5;
  return (
    <span className={`turn-clock${low ? " is-low" : ""}${low && local ? " is-wobble" : ""}`}>
      <img src={themeAsset(theme, "clock_alarm.png")} alt="" />
      <span className="turn-clock-num">{seconds}</span>
    </span>
  );
}

function LobbyModal({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="modal-ribbon">{title}</header>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function App() {
  const [lobbyModal, setLobbyModal] = useState<LobbyModalKind | null>(null);
  const tableRef = useRef<PhaserTableHandle | null>(null);
  const {
    authMode,
    authStatus,
    authStatusTone,
    cancelMatch,
    clearReplay,
    client,
    coinLedgers,
    createRoom,
    enterRoom,
    events,
    handlePass,
    handlePlay,
    historyStatus,
    leaveRoom,
    loadReplay,
    logout,
    matchQueue,
    matchRoom,
    nickname,
    password,
    reconnecting,
    refreshHistory,
    refreshRooms,
    replayPlaying,
    replayStatus,
    replayStep,
    roomStatus,
    rooms,
    roundHistory,
    selectedReplay,
    selectedRoom,
    session,
    setAuthMode,
    setNickname,
    setPassword,
    setReplayPlaying,
    setReplayStep,
    setTheme,
    setUsername,
    snapshot,
    status,
    submitAuth,
    tableControls,
    theme,
    turnTimer,
    username
  } = useDdzApp();

  // 本地玩家回合快超时时播放闹钟音（音效在 Phaser 场景内，经命令式句柄触发）
  const handleTurnAlarm = useCallback(() => {
    tableRef.current?.alertTimeout();
  }, []);
  useTurnAlarm(turnTimer, session?.user.id ?? "", handleTurnAlarm);

  if (!session) {
    return (
      <main className="auth-screen">
        <img className="auth-mascot mascot-left" src={themeAsset(theme, "mascot_left.png")} alt="" />
        <img className="auth-mascot mascot-right" src={themeAsset(theme, "mascot_right.png")} alt="" />
        <section className="auth-card">
          <img className="auth-logo" src="/assets/images/hall_logo_pic.png" alt="斗地主" />
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

  if (!selectedRoom && !selectedReplay) {
    // 选中回放（无房间）时也进入牌桌屏，走 table-replay-dock 回放控制
    const historyRows = (
      <div className="round-history">
        {roundHistory.length ? (
          roundHistory.map((round) => (
            <button
              key={round.id}
              type="button"
              className="history-row"
              onClick={() => {
                void loadReplay(round.id);
              }}
            >
              <div>
                <strong>{round.roomCode}</strong>
                <span>{round.endedAt ? formatDateTime(round.endedAt) : "进行中"}</span>
              </div>
              <em>{formatRoundDelta(round, session.user.id)}</em>
            </button>
          ))
        ) : (
          <p className="empty-state">{historyStatus}</p>
        )}
      </div>
    );

    return (
      <main className="lobby-screen">
        <header className="lobby-hud">
          <div className="player-plate">
            <img src={avatarAsset(theme, session.user.id)} alt="" />
            <div>
              <strong>{session.user.nickname}</strong>
              <span>{session.user.username}</span>
            </div>
          </div>
          <span className="coin-chip">
            <img src="/assets/images/coin.png" alt="" />
            {coinLedgers[0]?.balance ?? "-"}
          </span>
          {matchQueue ? (
            <div className="match-bar">
              <span className="match-bar-text">
                匹配中<span className="match-dots" />
              </span>
              <span className="match-bar-meta">
                队列 {matchQueue.waiting} 人 · 第 {matchQueue.position} 位
              </span>
              <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={cancelMatch}>
                取消匹配
              </button>
            </div>
          ) : null}
          <span className="hud-spacer" />
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={logout}>
            退出
          </button>
        </header>

        <section className="lobby-stage">
          <img className="stage-mascot mascot-left" src={themeAsset(theme, "mascot_left.png")} alt="" />
          <img className="stage-mascot mascot-right" src={themeAsset(theme, "mascot_right.png")} alt="" />
          <div className="stage-center">
            <img className="stage-logo" src="/assets/images/hall_logo_pic.png" alt="斗地主" />
            <button type="button" className="btn-img btn-img-orange btn-img-xl" onClick={matchRoom}>
              快速开始
            </button>
            <button type="button" className="btn-img btn-img-green btn-img-lg" onClick={createRoom}>
              创建房间
            </button>
            <p className="stage-status">{roomStatus}</p>
          </div>
          <nav className="feature-bar">
            <button type="button" onClick={() => setLobbyModal("history")}>
              <span className="feature-icon">
                <img src={themeAsset(theme, "icon_history.png")} alt="" />
              </span>
              <span>战绩</span>
            </button>
            <button type="button" onClick={() => setLobbyModal("ledger")}>
              <span className="feature-icon">
                <img src={themeAsset(theme, "icon_ledger.png")} alt="" />
              </span>
              <span>流水</span>
            </button>
            <button type="button" onClick={() => setLobbyModal("replay")}>
              <span className="feature-icon">
                <img src={themeAsset(theme, "icon_replay.png")} alt="" />
              </span>
              <span>回放</span>
            </button>
            <button type="button" onClick={() => setTheme(nextTheme(theme))}>
              <span className="feature-icon">
                <img src={themeAsset(theme, "icon_theme.png")} alt="" />
              </span>
              <span>{themeLabel(theme)}</span>
            </button>
          </nav>
        </section>

        <aside className="room-dock">
          <div className="section-heading">
            <h2>牌桌选择</h2>
            <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshRooms}>
              刷新
            </button>
          </div>
          <div className="room-list">
            {rooms.length ? (
              rooms.slice(0, 7).map((room, index) => (
                <button type="button" key={room.id} className="room-row" onClick={() => enterRoom(room)}>
                  <span className="room-medal">{index + 1}</span>
                  <span className="room-copy">
                    <strong>{room.code}</strong>
                    <span>{room.status === "open" ? "等待入座" : room.status}</span>
                  </span>
                  <span className="room-enter">进入</span>
                </button>
              ))
            ) : (
              <p className="empty-state">{roomStatus}</p>
            )}
          </div>
        </aside>

        {lobbyModal === "history" ? (
          <LobbyModal title="最近战绩" onClose={() => setLobbyModal(null)}>
            <div className="section-heading">
              <span className="modal-hint">点击一局进入回放</span>
              <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshHistory}>
                刷新
              </button>
            </div>
            {historyRows}
          </LobbyModal>
        ) : null}

        {lobbyModal === "ledger" ? (
          <LobbyModal title="金币流水" onClose={() => setLobbyModal(null)}>
            <div className="ledger-list">
              {coinLedgers.length ? (
                coinLedgers.map((ledger) => (
                  <div key={ledger.id} className="ledger-row">
                    <div>
                      <strong>{formatDelta(ledger.delta)}</strong>
                      <span>{ledger.roomCode}</span>
                    </div>
                    <em>{ledger.balance}</em>
                  </div>
                ))
              ) : (
                <p className="empty-state">{historyStatus}</p>
              )}
            </div>
          </LobbyModal>
        ) : null}

        {lobbyModal === "replay" ? (
          <LobbyModal title="对局回放" onClose={() => setLobbyModal(null)}>
            <div className="section-heading">
              <span className="modal-hint">{replayStatus}</span>
              <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshHistory}>
                刷新
              </button>
            </div>
            {historyRows}
          </LobbyModal>
        ) : null}
      </main>
    );
  }

  return (
    <main className="table-screen">
      <Suspense fallback={<section className="game-host loading-host">加载牌桌</section>}>
        <PhaserTable
          ref={tableRef}
          events={events}
          localPlayerId={session.user.id}
          onPass={handlePass}
          replay={selectedReplay}
          replayStep={replayStep}
          theme={theme}
          onPlay={handlePlay}
        />
      </Suspense>

      <header className="table-hud">
        <button
          type="button"
          className="btn-img btn-img-wood btn-img-sm"
          onClick={selectedRoom ? leaveRoom : clearReplay}
          disabled={selectedRoom ? !tableControls.leave : false}
        >
          ← 离开
        </button>
        <span className="table-chip">{selectedRoom ? status : "回放模式"}</span>
        {reconnecting ? <span className="table-chip">重连中…</span> : null}
        <span className="hud-spacer" />
      </header>

      {!selectedReplay
        ? (() => {
            // 所有阶段共用同一控制行：操作按钮居中、闹钟作为中间子元素，位置天然统一
            const localTurn = turnTimer != null && turnTimer.playerId === session.user.id;
            const clock =
              turnTimer != null ? (
                <TurnClock theme={theme} remainingMs={turnTimer.remainingMs} local={localTurn} />
              ) : null;

            let buttons: React.ReactNode = null;
            if (tableControls.ready) {
              buttons = (
                <button type="button" className="btn-img btn-img-orange" onClick={() => client.ready()}>
                  准备
                </button>
              );
            } else if (tableControls.bid) {
              buttons = (
                <>
                  <button type="button" className="btn-img btn-img-orange" onClick={() => client.bidLandlord(true)}>
                    叫地主
                  </button>
                  {clock}
                  <button type="button" className="btn-img btn-img-green" onClick={() => client.bidLandlord(false)}>
                    不叫
                  </button>
                </>
              );
            } else if (tableControls.rob) {
              buttons = (
                <>
                  <button type="button" className="btn-img btn-img-orange" onClick={() => client.robLandlord(true)}>
                    抢地主
                  </button>
                  {clock}
                  <button type="button" className="btn-img btn-img-green" onClick={() => client.robLandlord(false)}>
                    不抢
                  </button>
                </>
              );
            } else if (tableControls.pass) {
              // 出牌阶段轮到本地玩家：不出 / 闹钟 / 提示 / 出牌（出牌与提示经 ref 触发画布内选牌逻辑）
              buttons = (
                <>
                  <button type="button" className="btn-img btn-img-green" onClick={() => tableRef.current?.pass()}>
                    不出
                  </button>
                  {clock}
                  <button type="button" className="btn-img btn-img-blue" onClick={() => tableRef.current?.tip()}>
                    提示
                  </button>
                  <button type="button" className="btn-img btn-img-orange" onClick={() => tableRef.current?.play()}>
                    出牌
                  </button>
                </>
              );
            }

            // 既无可操作按钮、也无计时（如对手回合的非计时间隙）则不渲染控制行
            if (buttons == null && clock == null) {
              return null;
            }
            // 仅对手回合：行内只显示闹钟倒计时
            return <div className="table-control-row">{buttons ?? clock}</div>;
          })()
        : null}

      {!selectedReplay && snapshot?.phase === "settled" ? (
        <div className="table-settled-dock">
          <button type="button" className="btn-img btn-img-orange" onClick={leaveRoom}>
            返回大厅
          </button>
        </div>
      ) : null}

      {selectedReplay ? (
        <div className="table-replay-dock">
          <span className="table-chip">
            回放 {Math.min(replayStep + 1, selectedReplay.actions.length)}/{selectedReplay.actions.length}
          </span>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={selectedReplay.actions.length <= 1}
            onClick={() => setReplayPlaying((playing) => !playing)}
          >
            {replayPlaying ? "暂停" : "播放"}
          </button>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={replayStep <= 0}
            onClick={() => {
              setReplayPlaying(false);
              setReplayStep((step) => Math.max(0, step - 1));
            }}
          >
            上一步
          </button>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={replayStep >= selectedReplay.actions.length - 1}
            onClick={() => {
              setReplayPlaying(false);
              setReplayStep((step) => Math.min(selectedReplay.actions.length - 1, step + 1));
            }}
          >
            下一步
          </button>
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={clearReplay}>
            {selectedRoom ? "返回牌桌" : "返回大厅"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
