import React, { Suspense, lazy, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatDateTime, formatDelta, formatRoundDelta, formatTurnTimer } from "./app/formatters";
import { useDdzApp } from "./app/useDdzApp";
import "./styles.css";

const PhaserTable = lazy(async () => {
  const module = await import("./PhaserTable");
  return {
    default: module.PhaserTable
  };
});

type LobbyModalKind = "history" | "ledger" | "replay";

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
  const {
    authMode,
    authStatus,
    authStatusTone,
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
    matchRoom,
    nickname,
    password,
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
    setUsername,
    snapshot,
    status,
    submitAuth,
    tableControls,
    turnTimer,
    username
  } = useDdzApp();

  if (!session) {
    return (
      <main className="auth-screen">
        <img className="auth-mascot mascot-left" src="/assets/images/hall_user2.png" alt="" />
        <img className="auth-mascot mascot-right" src="/assets/images/hall_user.png" alt="" />
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
              <button type="submit" className="btn-jelly btn-orange btn-lg">
                {authMode === "login" ? "开始游戏" : "注册并登录"}
              </button>
              <button
                type="button"
                className="btn-jelly btn-green"
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
            <img src="/assets/images/avatar/1.png" alt="" />
            <div>
              <strong>{session.user.nickname}</strong>
              <span>{session.user.username}</span>
            </div>
          </div>
          <span className="coin-chip">
            <img src="/assets/images/coin.png" alt="" />
            {coinLedgers[0]?.balance ?? "-"}
          </span>
          <span className="hud-spacer" />
          <button type="button" className="hud-button" onClick={logout}>
            退出
          </button>
        </header>

        <section className="lobby-stage">
          <img className="stage-mascot mascot-left" src="/assets/images/hall_user2.png" alt="" />
          <img className="stage-mascot mascot-right" src="/assets/images/hall_user.png" alt="" />
          <div className="stage-center">
            <img className="stage-logo" src="/assets/images/hall_logo_pic.png" alt="斗地主" />
            <button type="button" className="btn-jelly btn-orange btn-xl" onClick={matchRoom}>
              快速开始
            </button>
            <button type="button" className="btn-jelly btn-green btn-lg" onClick={createRoom}>
              创建房间
            </button>
            <p className="stage-status">{roomStatus}</p>
          </div>
          <nav className="feature-bar">
            <button type="button" onClick={() => setLobbyModal("history")}>
              <span className="feature-icon">
                <img src="/assets/images/generated/lobby/icon_history.png" alt="" />
              </span>
              <span>战绩</span>
            </button>
            <button type="button" onClick={() => setLobbyModal("ledger")}>
              <span className="feature-icon">
                <img src="/assets/images/generated/lobby/icon_ledger.png" alt="" />
              </span>
              <span>流水</span>
            </button>
            <button type="button" onClick={() => setLobbyModal("replay")}>
              <span className="feature-icon">
                <img src="/assets/images/generated/lobby/icon_replay.png" alt="" />
              </span>
              <span>回放</span>
            </button>
          </nav>
        </section>

        <aside className="room-dock">
          <div className="section-heading">
            <h2>牌桌选择</h2>
            <button type="button" className="hud-button" onClick={refreshRooms}>
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
              <button type="button" className="hud-button" onClick={refreshHistory}>
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
              <button type="button" className="hud-button" onClick={refreshHistory}>
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
          events={events}
          localPlayerId={session.user.id}
          onPass={handlePass}
          replay={selectedReplay}
          replayStep={replayStep}
          onPlay={handlePlay}
        />
      </Suspense>

      <header className="table-hud">
        <button
          type="button"
          className="hud-button"
          onClick={selectedRoom ? leaveRoom : clearReplay}
          disabled={selectedRoom ? !tableControls.leave : false}
        >
          ← 离开
        </button>
        <span className="table-chip">{selectedRoom ? status : "回放模式"}</span>
        <span className="hud-spacer" />
        <span className="table-chip timer-chip">{turnTimer ? formatTurnTimer(turnTimer, session.user.id) : ""}</span>
      </header>

      {tableControls.ready || tableControls.bid || tableControls.rob ? (
        <div className="table-action-dock">
          {tableControls.ready ? (
            <button type="button" className="btn-jelly btn-orange btn-lg" onClick={() => client.ready()}>
              准备
            </button>
          ) : null}
          {tableControls.bid ? (
            <>
              <button type="button" className="btn-jelly btn-orange btn-lg" onClick={() => client.bidLandlord(true)}>
                叫地主
              </button>
              <button type="button" className="btn-jelly btn-green btn-lg" onClick={() => client.bidLandlord(false)}>
                不叫
              </button>
            </>
          ) : null}
          {tableControls.rob ? (
            <>
              <button type="button" className="btn-jelly btn-orange btn-lg" onClick={() => client.robLandlord(true)}>
                抢地主
              </button>
              <button type="button" className="btn-jelly btn-green btn-lg" onClick={() => client.robLandlord(false)}>
                不抢
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {!selectedReplay && snapshot?.phase === "settled" ? (
        <div className="table-settled-dock">
          <button type="button" className="btn-jelly btn-orange btn-lg" onClick={leaveRoom}>
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
            className="hud-button"
            disabled={selectedReplay.actions.length <= 1}
            onClick={() => setReplayPlaying((playing) => !playing)}
          >
            {replayPlaying ? "暂停" : "播放"}
          </button>
          <button
            type="button"
            className="hud-button"
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
            className="hud-button"
            disabled={replayStep >= selectedReplay.actions.length - 1}
            onClick={() => {
              setReplayPlaying(false);
              setReplayStep((step) => Math.min(selectedReplay.actions.length - 1, step + 1));
            }}
          >
            下一步
          </button>
          <button type="button" className="hud-button" onClick={clearReplay}>
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
