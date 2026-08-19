import type { RefObject } from "react";
import type { ThemeId } from "../../theme";
import type { PhaserTableHandle } from "../../PhaserTable";
import { SeatThinkCloud } from "./SeatThinkCloud";
import { SeatTurnClock } from "./SeatTurnClock";
import { SettlementPanel } from "./SettlementPanel";
import { TableControlRow } from "./TableControlRow";
import type { RoomSession } from "../useRoomSession";

interface TableOverlayProps {
  readonly room: RoomSession;
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly tableRef: RefObject<PhaserTableHandle | null>;
  readonly onLeave: () => void;
  readonly onOpenSettings: () => void;
}

/**
 * 牌桌 DOM 覆盖层：承接实况对局的“面板/按钮/弹窗/滚动文本”类 UI。
 * PhaserTable 只负责牌桌舞台、牌对象、选牌、动画和音效；新增 UI 功能优先放这里拆组件。
 */
export function TableOverlay({ room, localPlayerId, theme, tableRef, onLeave, onOpenSettings }: TableOverlayProps) {
  const { tableControls, status, reconnecting, client, turnTimer, snapshot, thinking } = room;

  return (
    <>
      <SeatThinkCloud snapshot={snapshot} thinking={thinking} localPlayerId={localPlayerId} />
      <SeatTurnClock snapshot={snapshot} turnTimer={turnTimer} localPlayerId={localPlayerId} theme={theme} />

      <header className="table-hud">
        <button
          type="button"
          className="btn-img btn-img-wood btn-img-sm"
          onClick={onLeave}
          disabled={!tableControls.leave}
        >
          ← 离开
        </button>
        <span className="table-chip">{status}</span>
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

      {snapshot?.phase !== "settled" ? (
        <TableControlRow
          controls={tableControls}
          turnTimer={turnTimer}
          localId={localPlayerId}
          theme={theme}
          client={client}
          tableRef={tableRef}
        />
      ) : null}

      {snapshot?.phase === "settled" ? (
        <SettlementPanel
          snapshot={snapshot}
          localPlayerId={localPlayerId}
          canReady={tableControls.ready}
          onReady={() => client.ready()}
          onLeave={onLeave}
        />
      ) : null}
    </>
  );
}
