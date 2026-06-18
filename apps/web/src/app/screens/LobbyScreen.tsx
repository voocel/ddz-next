import { useState } from "react";
import { avatarAsset, nextTheme, themeAsset, themeLabel } from "../../theme";
import { formatDateTime, formatDelta, formatRoundDelta } from "../formatters";
import { Modal } from "../components/Modal";
import type { DdzApp } from "../useDdzApp";

type LobbyModalKind = "history" | "ledger" | "replay" | "rooms";

export function LobbyScreen({ app, onOpenSettings }: { app: DdzApp; onOpenSettings: () => void }) {
  const [lobbyModal, setLobbyModal] = useState<LobbyModalKind | null>(null);
  const {
    session,
    theme,
    coinLedgers,
    matchQueue,
    cancelMatch,
    logout,
    matchRoom,
    aiBattle,
    createRoom,
    roomStatus,
    setTheme,
    refreshRooms,
    rooms,
    enterRoom,
    refreshHistory,
    roundHistory,
    loadReplay,
    historyStatus,
    replayStatus
  } = app;

  // 大厅仅在已登录时渲染（App 已据 session 分屏），此处守卫满足类型收窄
  if (!session) {
    return null;
  }

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
          <button
            type="button"
            className="btn-img btn-img-ai btn-img-lg btn-ai"
            onClick={() => {
              void aiBattle();
            }}
          >
            大模型对战
          </button>
          <button type="button" className="btn-img btn-img-orange btn-img-lg" onClick={matchRoom}>
            快速开始
          </button>
          <button type="button" className="btn-img btn-img-green btn-img-lg" onClick={createRoom}>
            创建房间
          </button>
          <p className="stage-status">{roomStatus}</p>
        </div>
        <nav className="feature-bar">
          <button type="button" onClick={() => setLobbyModal("rooms")}>
            <span className="feature-icon feature-icon-emoji">🀄</span>
            <span>牌桌</span>
          </button>
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
          <button type="button" onClick={onOpenSettings}>
            <span className="feature-icon feature-icon-emoji">⚙️</span>
            <span>设置</span>
          </button>
        </nav>
      </section>

      {lobbyModal === "rooms" ? (
        <Modal title="牌桌选择" onClose={() => setLobbyModal(null)}>
          <div className="section-heading">
            <span className="modal-hint">点击一桌入座</span>
            <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshRooms}>
              刷新
            </button>
          </div>
          <div className="room-list">
            {rooms.length ? (
              rooms.slice(0, 7).map((room, index) => (
                <button
                  type="button"
                  key={room.id}
                  className="room-row"
                  onClick={() => {
                    enterRoom(room);
                    setLobbyModal(null);
                  }}
                >
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
        </Modal>
      ) : null}

      {lobbyModal === "history" ? (
        <Modal title="最近战绩" onClose={() => setLobbyModal(null)}>
          <div className="section-heading">
            <span className="modal-hint">点击一局进入回放</span>
            <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshHistory}>
              刷新
            </button>
          </div>
          {historyRows}
        </Modal>
      ) : null}

      {lobbyModal === "ledger" ? (
        <Modal title="金币流水" onClose={() => setLobbyModal(null)}>
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
        </Modal>
      ) : null}

      {lobbyModal === "replay" ? (
        <Modal title="对局回放" onClose={() => setLobbyModal(null)}>
          <div className="section-heading">
            <span className="modal-hint">{replayStatus}</span>
            <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={refreshHistory}>
              刷新
            </button>
          </div>
          {historyRows}
        </Modal>
      ) : null}
    </main>
  );
}
