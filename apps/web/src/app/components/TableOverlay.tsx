import type { RefObject } from "react";
import type { PhaserTableHandle } from "../../PhaserTable";
import { BotThinkingBubble } from "./BotThinkingBubble";
import { SeatTurnClock } from "./SeatTurnClock";
import { SettlementPanel } from "./SettlementPanel";
import { TableControlRow } from "./TableControlRow";
import type { DdzApp } from "../useDdzApp";

interface TableOverlayProps {
  readonly app: DdzApp;
  readonly tableRef: RefObject<PhaserTableHandle | null>;
  readonly onOpenSettings: () => void;
}

/**
 * 牌桌 DOM 覆盖层：承接所有“面板/按钮/弹窗/滚动文本”类 UI。
 * PhaserTable 只负责牌桌舞台、牌对象、选牌、动画和音效；新增 UI 功能优先放这里拆组件。
 */
export function TableOverlay({ app, tableRef, onOpenSettings }: TableOverlayProps) {
  const {
    session,
    selectedReplay,
    selectedRoom,
    leaveRoom,
    clearReplay,
    tableControls,
    status,
    reconnecting,
    client,
    turnTimer,
    snapshot,
    thinking,
    replayPlaying,
    replayStep,
    setReplayPlaying,
    setReplayStep,
    theme
  } = app;

  if (!session) {
    return null;
  }

  const showLiveOverlays = !selectedReplay;

  return (
    <>
      {showLiveOverlays ? (
        <>
          <BotThinkingBubble thinking={thinking} snapshot={snapshot} localPlayerId={session.user.id} />
          <SeatTurnClock snapshot={snapshot} turnTimer={turnTimer} localPlayerId={session.user.id} theme={theme} />
        </>
      ) : null}

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

      {showLiveOverlays && snapshot?.phase !== "settled" ? (
        <TableControlRow
          controls={tableControls}
          turnTimer={turnTimer}
          localId={session.user.id}
          theme={theme}
          client={client}
          tableRef={tableRef}
        />
      ) : null}

      {showLiveOverlays && snapshot?.phase === "settled" ? (
        <SettlementPanel
          snapshot={snapshot}
          localPlayerId={session.user.id}
          canReady={tableControls.ready}
          onReady={() => client.ready()}
          onLeave={leaveRoom}
        />
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
    </>
  );
}
