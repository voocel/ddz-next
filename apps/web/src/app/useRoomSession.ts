import { useMemo } from "react";
import type { BotModelRefDto, LoginResponse } from "@ddz/protocol";
import type { ReasoningEffort } from "../lineupDefaults";
import { getTableControlsState } from "../game/controlsState";
import { useGameRoomCore } from "./useGameRoomCore";

interface RoomSessionInput {
  readonly code: string;
  readonly session: LoginResponse;
  /** 建桌参数（经路由 state 携带）：2 席 AI 对手阵容 + 思考强度；回房/直连传 null */
  readonly create: {
    readonly lineup: readonly BotModelRefDto[];
    readonly reasoningEffort: ReasoningEffort;
  } | null;
  /** round_settled 旁路（刷新个人战绩等跨域接线） */
  readonly onRoundSettled: () => void;
  /** 房间终结（被踢/故障/重连超时）：去向交调用方 */
  readonly onEnded: (reason: string) => void;
}

/**
 * 入座对局域：useGameRoomCore 之上的薄壳，恒以 quickStart 入房（首连自动准备），
 * 补出牌操作可用态（tableControls）。挂载即入房、卸载即离房。
 */
export function useRoomSession(input: RoomSessionInput) {
  const core = useGameRoomCore({
    code: input.code,
    session: input.session,
    quickStart: true,
    lineup: input.create?.lineup ?? null,
    reasoningEffort: input.create?.reasoningEffort ?? null,
    onEvent: (event) => {
      if (event.type === "round_settled") {
        input.onRoundSettled();
      }
      return false;
    },
    onEnded: input.onEnded
  });

  const tableControls = useMemo(
    () => getTableControlsState(core.snapshot, input.session.user.id, true),
    [core.snapshot, input.session.user.id]
  );

  return { ...core, tableControls };
}

export type RoomSession = ReturnType<typeof useRoomSession>;
