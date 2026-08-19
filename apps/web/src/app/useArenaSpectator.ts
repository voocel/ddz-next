import { useRef, useState } from "react";
import type { BotModelRefDto, LoginResponse } from "@ddz/protocol";
import type { ReasoningEffort } from "../lineupDefaults";
import { useGameRoomCore } from "./useGameRoomCore";

export interface ArenaCommentaryItem {
  readonly text: string;
  readonly tag?: string | undefined;
  /** 递增序号：同文案连续出现时也能触发字幕重新入场动画 */
  readonly seq: number;
}

interface ArenaSpectatorInput {
  readonly code: string;
  readonly session: LoginResponse;
  /** 创建新竞技场时的三席阵容（首个观众入房时创建对局生效）；观战已有直播传 null */
  readonly lineup: readonly BotModelRefDto[] | null;
  /** 创建方所选思考强度（随 lineup 首次创建时生效）；null 由服务端定默认（medium） */
  readonly botReasoningEffort: ReasoningEffort | null;
}

/**
 * 竞技场观战域：useGameRoomCore 之上的薄壳，只补观战特有的解说字幕与「直播已结束」遮罩。
 * 观众没有手牌、回合与操作，只有观看状态。
 */
export function useArenaSpectator(input: ArenaSpectatorInput) {
  const [commentary, setCommentary] = useState<ArenaCommentaryItem | null>(null);
  // 直播已终结（房间故障/重连超时）：观战页据此盖提示层引导回大厅
  const [ended, setEnded] = useState<string | null>(null);
  const commentarySeq = useRef(0);

  const core = useGameRoomCore({
    code: input.code,
    session: input.session,
    spectate: true,
    arena: true,
    lineup: input.lineup,
    reasoningEffort: input.botReasoningEffort,
    onEvent: (event) => {
      if (event.type === "commentary") {
        // 赛事解说走独立字幕条,不进 events 反馈行
        commentarySeq.current += 1;
        setCommentary({ text: event.text, tag: event.tag, seq: commentarySeq.current });
        return true;
      }
      return false;
    },
    onEnded: () => setEnded("直播已结束")
  });

  return { ...core, commentary, ended };
}
