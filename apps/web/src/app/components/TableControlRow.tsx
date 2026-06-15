import type { ReactNode, RefObject } from "react";
import { TurnClock } from "./TurnClock";
import type { PhaserTableHandle } from "../../PhaserTable";
import type { TableControlsState } from "../../game/controlsState";
import type { ThemeId } from "../../theme";
import type { TurnTimerState } from "../types";
import type { DdzApp } from "../useDdzApp";

interface TableControlRowProps {
  readonly controls: TableControlsState;
  readonly turnTimer: TurnTimerState | null;
  readonly localId: string;
  readonly theme: ThemeId;
  readonly client: DdzApp["client"];
  readonly tableRef: RefObject<PhaserTableHandle | null>;
}

/**
 * 出牌阶段的统一控制行：操作按钮居中、闹钟作为中间子元素，位置天然统一。
 * 准备/叫地主/抢地主/出牌经 client 或画布句柄触发；仅对手回合时只渲染闹钟倒计时。
 * 既无可操作按钮、也无计时（如对手回合的非计时间隙）则不渲染。
 */
export function TableControlRow({ controls, turnTimer, localId, theme, client, tableRef }: TableControlRowProps) {
  const localTurn = turnTimer != null && turnTimer.playerId === localId;
  const clock = turnTimer != null ? <TurnClock theme={theme} remainingMs={turnTimer.remainingMs} local={localTurn} /> : null;

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
        <button type="button" className="btn-img btn-img-orange" onClick={() => client.robLandlord(true)}>
          抢地主
        </button>
        {clock}
        <button type="button" className="btn-img btn-img-green" onClick={() => client.robLandlord(false)}>
          不抢
        </button>
      </>
    );
  } else if (controls.pass) {
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

  if (buttons == null && clock == null) {
    return null;
  }
  // 仅对手回合：行内只显示闹钟倒计时
  return <div className="table-control-row">{buttons ?? clock}</div>;
}
