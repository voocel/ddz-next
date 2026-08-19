import type { ReactNode, RefObject } from "react";
import { TurnClock } from "./TurnClock";
import type { PhaserTableHandle } from "../../PhaserTable";
import type { TableControlsState } from "../../game/controlsState";
import type { ThemeId } from "../../theme";
import type { TurnTimerState } from "../types";
import type { createGameClient } from "../../net/gameClient";

interface TableControlRowProps {
  readonly controls: TableControlsState;
  readonly turnTimer: TurnTimerState | null;
  readonly localId: string;
  readonly theme: ThemeId;
  readonly client: ReturnType<typeof createGameClient>;
  readonly tableRef: RefObject<PhaserTableHandle | null>;
}

/**
 * 出牌阶段的统一控制行：本地回合把闹钟放回按钮中间；对手回合由 SeatTurnClock 锚到对手头像旁。
 * 准备/叫地主/抢地主/出牌经 client 或画布句柄触发；无本地可操作按钮则不渲染。
 */
export function TableControlRow({ controls, turnTimer, localId, theme, client, tableRef }: TableControlRowProps) {
  const localTurn = turnTimer != null && turnTimer.playerId === localId;
  const clock = localTurn ? <TurnClock theme={theme} remainingMs={turnTimer.remainingMs} local={true} /> : null;

  let buttons: ReactNode = null;
  if (controls.ready) {
    buttons = (
      <button type="button" className="btn-img btn-img-orange" onClick={() => client.ready()}>
        准备
      </button>
    );
  } else if (controls.bid) {
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
  } else if (controls.rob) {
    buttons = (
      <>
        <button type="button" className="btn-img btn-img-green" onClick={() => client.robLandlord(false)}>
          不抢
        </button>
        {clock}
        <button type="button" className="btn-img btn-img-orange" onClick={() => client.robLandlord(true)}>
          抢地主
        </button>
      </>
    );
  } else if (controls.pass) {
    // 出牌阶段轮到本地玩家：不出 / 提示 / 出牌（出牌与提示经 ref 触发画布内选牌逻辑）
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

  if (buttons == null) {
    return null;
  }
  return <div className="table-control-row">{buttons}</div>;
}
