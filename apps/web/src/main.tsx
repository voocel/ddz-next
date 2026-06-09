import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import {
  formatActionType,
  formatDateTime,
  formatDelta,
  formatReplayAction,
  formatRoundDelta,
  formatTurnTimer,
  formatUser
} from "./app/formatters";
import { useDdzApp } from "./app/useDdzApp";
import "./styles.css";

const PhaserTable = lazy(async () => {
  const module = await import("./PhaserTable");
  return {
    default: module.PhaserTable
  };
});

function App() {
  const {
    authMode,
    authStatus,
    clearReplay,
    client,
    coinLedgers,
    createRoom,
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
    selectRoom,
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
        <section className="auth-card">
          <div>
            <p className="eyebrow">DDZ Next</p>
            <h1>斗地主</h1>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <label>
              用户名
              <input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} />
            </label>
            {authMode === "register" ? (
              <label>
                昵称
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  minLength={1}
                  maxLength={32}
                />
              </label>
            ) : null}
            <label>
              密码
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={6}
                maxLength={128}
              />
            </label>
            <div className="auth-actions">
              <button type="submit">{authMode === "login" ? "登录" : "注册并登录"}</button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
              >
                {authMode === "login" ? "注册新账号" : "返回登录"}
              </button>
            </div>
            <p className="form-status">{authStatus}</p>
          </form>
        </section>
      </main>
    );
  }

  if (!selectedRoom) {
    return (
      <main className="lobby-screen">
        <header className="lobby-hud">
          <div className="lobby-brand">
            <img src="/assets/images/hall_logo_pic.png" alt="斗地主" />
            <div>
              <p className="eyebrow">DDZ Next</p>
              <h1>牌局大厅</h1>
            </div>
          </div>
          <div className="player-hud">
            <img src="/assets/images/avatar/1.png" alt="" />
            <div>
              <strong>{session.user.nickname}</strong>
              <span>{session.user.username}</span>
            </div>
            <span className="coin-chip">
              <img src="/assets/images/generated/coin.png" alt="" />
              {coinLedgers[0]?.balance ?? 1000}
            </span>
            <button type="button" className="hud-button" onClick={logout}>
              退出
            </button>
          </div>
        </header>

        <section className="lobby-game-layout">
          <section className="lobby-play-stage">
            <img className="lobby-attendant" src="/assets/images/hall_user.png" alt="" />
            <img className="lobby-table-art" src="/assets/images/generated/table_surface.png" alt="" />
            <div className="lobby-stage-ribbon">
              <p className="eyebrow">Ready</p>
              <h2>选一张牌桌，马上开局</h2>
            </div>
            <div className="lobby-action-ring">
              <button type="button" className="lobby-image-action create-room-action" onClick={createRoom} aria-label="创建房间">
                <img src="/assets/images/button/create_room.png" alt="" />
              </button>
              <button type="button" className="lobby-image-action match-room-action" onClick={matchRoom} aria-label="快速匹配">
                <img src="/assets/images/button/match_room.png" alt="" />
              </button>
            </div>
            <div className="lobby-status-strip">
              <span>{roomStatus}</span>
              <button type="button" className="hud-button" onClick={refreshRooms}>
                刷新牌桌
              </button>
            </div>
          </section>

          <aside className="lobby-room-dock">
            <div className="section-heading">
              <h2>开放牌桌</h2>
              <button type="button" className="hud-button" onClick={refreshRooms}>
                刷新
              </button>
            </div>
            <div className="room-list game-room-list">
              {rooms.length ? (
                rooms.slice(0, 7).map((room) => (
                  <button
                    type="button"
                    key={room.id}
                    className="room-row game-room-row"
                    onClick={() => selectRoom(room)}
                  >
                    <span className="room-medal">桌</span>
                    <strong>{room.code}</strong>
                    <span>{room.status}</span>
                    <em>入座</em>
                  </button>
                ))
              ) : (
                <p className="empty-state">{roomStatus}</p>
              )}
            </div>
          </aside>

          <aside className="lobby-side-stack">
            <section className="history-panel game-info-panel">
              <div className="section-heading">
                <h2>最近战绩</h2>
                <button type="button" className="hud-button" onClick={refreshHistory}>
                  刷新
                </button>
              </div>
              <div className="round-history">
                {roundHistory.length ? (
                  roundHistory.slice(0, 4).map((round) => (
                    <button
                      key={round.id}
                      type="button"
                      className="history-row"
                      data-selected={selectedReplay?.id === round.id}
                      onClick={() => void loadReplay(round.id)}
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
            </section>

            <section className="ledger-panel game-info-panel">
              <h2>金币流水</h2>
              <div className="ledger-list">
                {coinLedgers.length ? (
                  coinLedgers.slice(0, 4).map((ledger) => (
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
            </section>

            <section className="replay-panel game-info-panel">
              <div className="section-heading">
                <h2>回放</h2>
                <span className="step-counter">
                  {selectedReplay
                    ? `${Math.min(replayStep + 1, selectedReplay.actions.length)}/${selectedReplay.actions.length}`
                    : "-"}
                </span>
              </div>
              <div className="replay-controls">
                <button
                  type="button"
                  disabled={!selectedReplay || selectedReplay.actions.length <= 1}
                  onClick={() => setReplayPlaying((playing) => !playing)}
                >
                  {replayPlaying ? "暂停" : "播放"}
                </button>
                <button
                  type="button"
                  disabled={!selectedReplay || replayStep <= 0}
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayStep((step) => Math.max(0, step - 1));
                  }}
                >
                  上一步
                </button>
                <button
                  type="button"
                  disabled={!selectedReplay || replayStep >= selectedReplay.actions.length - 1}
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayStep((step) => Math.min((selectedReplay?.actions.length ?? 1) - 1, step + 1));
                  }}
                >
                  下一步
                </button>
              </div>
              {selectedReplay ? (
                <div className="replay-list">
                  {selectedReplay.actions.map((action, index) => (
                    <button
                      key={action.id}
                      type="button"
                      className="replay-row"
                      data-selected={index === replayStep}
                      onClick={() => {
                        setReplayPlaying(false);
                        setReplayStep(index);
                      }}
                    >
                      <strong>{formatActionType(action.type)}</strong>
                      <span>{formatReplayAction(action)}</span>
                      <em>{formatDateTime(action.createdAt)}</em>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{replayStatus}</p>
              )}
            </section>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div>
          <p className="eyebrow">DDZ Next</p>
          <h1>斗地主重构版</h1>
        </div>
        <dl className="status-list">
          <div>
            <dt>连接</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>玩家</dt>
            <dd>{session.user.id}</dd>
          </div>
          <div>
            <dt>账号</dt>
            <dd>{formatUser(session.user)}</dd>
          </div>
          <div>
            <dt>房间</dt>
            <dd>{selectedRoom.code}</dd>
          </div>
          <div>
            <dt>回合</dt>
            <dd>{turnTimer ? formatTurnTimer(turnTimer, session.user.id) : "-"}</dd>
          </div>
        </dl>
        <section className="players">
          <h2>座位</h2>
          {snapshot?.players.length ? (
            <div className="player-list">
              {snapshot.players.map((player) => (
                <div key={player.id} className="player-row">
                  <span>#{player.seat + 1}</span>
                  <strong>{player.id}</strong>
                  <em data-online={player.connected}>{player.connected ? "在线" : "离线"}</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">等待玩家入座</p>
          )}
        </section>
        <section className="history-panel">
          <div className="section-heading">
            <h2>战绩</h2>
            <button type="button" onClick={refreshHistory}>
              刷新
            </button>
          </div>
          <div className="round-history">
            {roundHistory.length ? (
              roundHistory.slice(0, 4).map((round) => (
                <button
                  key={round.id}
                  type="button"
                  className="history-row"
                  data-selected={selectedReplay?.id === round.id}
                  onClick={() => void loadReplay(round.id)}
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
        </section>
        <section className="replay-panel">
          <div className="section-heading">
            <h2>回放</h2>
            <span className="step-counter">
              {selectedReplay ? `${Math.min(replayStep + 1, selectedReplay.actions.length)}/${selectedReplay.actions.length}` : "-"}
            </span>
          </div>
          <div className="replay-controls">
            <button
              type="button"
              disabled={!selectedReplay || selectedReplay.actions.length <= 1}
              onClick={() => setReplayPlaying((playing) => !playing)}
            >
              {replayPlaying ? "暂停" : "播放"}
            </button>
            <button
              type="button"
              disabled={!selectedReplay || replayStep <= 0}
              onClick={() => {
                setReplayPlaying(false);
                setReplayStep((step) => Math.max(0, step - 1));
              }}
            >
              上一步
            </button>
            <button
              type="button"
              disabled={!selectedReplay || replayStep >= selectedReplay.actions.length - 1}
              onClick={() => {
                setReplayPlaying(false);
                setReplayStep((step) => Math.min((selectedReplay?.actions.length ?? 1) - 1, step + 1));
              }}
            >
              下一步
            </button>
            <button type="button" disabled={!selectedReplay} onClick={clearReplay}>
              返回牌桌
            </button>
          </div>
          {selectedReplay ? (
            <div className="replay-list">
              {selectedReplay.actions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  className="replay-row"
                  data-selected={index === replayStep}
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayStep(index);
                  }}
                >
                  <strong>{formatActionType(action.type)}</strong>
                  <span>{formatReplayAction(action)}</span>
                  <em>{formatDateTime(action.createdAt)}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-state">{replayStatus}</p>
          )}
        </section>
        <section className="ledger-panel">
          <h2>金币流水</h2>
          <div className="ledger-list">
            {coinLedgers.length ? (
              coinLedgers.slice(0, 5).map((ledger) => (
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
        </section>
        <div className="controls">
          <button type="button" onClick={() => client.ready()} disabled={!tableControls.ready}>
            准备
          </button>
          <button type="button" onClick={() => client.bidLandlord(true)} disabled={!tableControls.bid}>
            叫地主
          </button>
          <button type="button" onClick={() => client.bidLandlord(false)} disabled={!tableControls.bid}>
            不叫
          </button>
          <button type="button" onClick={() => client.robLandlord(true)} disabled={!tableControls.rob}>
            抢地主
          </button>
          <button type="button" onClick={() => client.robLandlord(false)} disabled={!tableControls.rob}>
            不抢
          </button>
          <button type="button" onClick={() => client.pass()} disabled={!tableControls.pass}>
            过牌
          </button>
          <button type="button" onClick={leaveRoom} disabled={!tableControls.leave}>
            离开房间
          </button>
        </div>
        <section className="events">
          <h2>事件</h2>
          {events.map((event, index) => (
            <pre key={`${event.type}-${index}`}>{JSON.stringify(event, null, 2)}</pre>
          ))}
        </section>
      </aside>
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
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
