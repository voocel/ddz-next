import { Suspense, lazy, type RefObject } from "react";
import { TableControlRow } from "../components/TableControlRow";
import type { PhaserTableHandle } from "../../PhaserTable";
import type { DdzApp } from "../useDdzApp";

const PhaserTable = lazy(async () => {
  const module = await import("../../PhaserTable");
  return {
    default: module.PhaserTable
  };
});

export function TableScreen({
  app,
  tableRef,
  onOpenSettings
}: {
  app: DdzApp;
  tableRef: RefObject<PhaserTableHandle | null>;
  onOpenSettings: () => void;
}) {
  const {
    session,
    events,
    handlePass,
    handlePlay,
    selectedReplay,
    replayStep,
    theme,
    audioLevels,
    selectedRoom,
    leaveRoom,
    clearReplay,
    tableControls,
    status,
    reconnecting,
    client,
    turnTimer,
    snapshot,
    replayPlaying,
    setReplayPlaying,
    setReplayStep
  } = app;

  // 牌桌仅在已登录时渲染（App 已据 session 分屏），此处守卫满足类型收窄
  if (!session) {
    return null;
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
          audioLevels={audioLevels}
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
        <button
          type="button"
          className="btn-img btn-img-wood btn-img-sm"
          onClick={onOpenSettings}
          aria-label="设置"
        >
          ⚙️ 设置
        </button>
      </header>

      {!selectedReplay ? (
        <TableControlRow
          controls={tableControls}
          turnTimer={turnTimer}
          localId={session.user.id}
          theme={theme}
          client={client}
          tableRef={tableRef}
        />
      ) : null}

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
