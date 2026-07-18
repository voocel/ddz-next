import { useEffect, useMemo, useRef, useState } from "react";
import type { BotModelRefDto, GameEvent, GameSnapshotDto, LoginResponse } from "@ddz/protocol";
import { createGameClient, isRecoverableDropCode } from "../net/gameClient";
import type { ReasoningEffort } from "../botPreferences";
import { reduceBotDecisionFailed, reduceThinking, EMPTY_THINKING, type BotThinkingState } from "../botThinking";
import type { TurnTimerState } from "./types";
import { useTurnTimerTicker } from "./useTurnTimerTicker";

const RECONNECT_RETRY_MS = 2_000;
const RECONNECT_DEADLINE_MS = 15_000;

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
 * 竞技场观战域：以观众身份连接直播房，聚合快照、AI 输出流与解说字幕。
 * 与 useDdzApp 的入座对局域彻底分离——观众没有手牌、回合与操作，只有观看状态。
 */
export function useArenaSpectator(input: ArenaSpectatorInput) {
  const [status, setStatus] = useState("连接中");
  const [snapshot, setSnapshot] = useState<GameSnapshotDto | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [thinking, setThinking] = useState<BotThinkingState>(EMPTY_THINKING);
  const [commentary, setCommentary] = useState<ArenaCommentaryItem | null>(null);
  const [turnTimer, setTurnTimer] = useState<TurnTimerState | null>(null);
  // 直播已终结（房间故障/重连超时）：观战页据此盖提示层引导回大厅
  const [ended, setEnded] = useState<string | null>(null);
  const [reconnectRequest, setReconnectRequest] = useState<number | null>(null);
  const commentarySeq = useRef(0);

  const client = useMemo(
    () =>
      createGameClient({
        endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
        playerId: input.session.user.id,
        accessToken: input.session.accessToken,
        roomCode: input.code,
        spectate: true,
        arenaLineup: input.lineup,
        arenaReasoningEffort: input.botReasoningEffort,
        onStatus: setStatus,
        onDropped: (code) => {
          if (!isRecoverableDropCode(code)) {
            setEnded("直播已结束");
            return;
          }
          // 网络抖动或收官正常散场都会走这里：重连由下方副作用兜底，失败即认定直播终结
          setStatus("连接已断开，正在重连…");
          setReconnectRequest(Date.now());
        },
        onEvent: (event) => {
          if ("snapshot" in event) {
            setSnapshot(event.snapshot);
            // 回合推进后旧倒计时立即失效:下一位的 turn_timer 会紧跟着重新点亮
            setTurnTimer((current) =>
              current && current.playerId !== event.snapshot.currentPlayerId ? null : current
            );
          }
          if (event.type === "turn_timer") {
            setTurnTimer({
              deadlineAt: event.deadlineAt,
              durationMs: event.durationMs,
              playerId: event.playerId,
              remainingMs: Math.max(0, new Date(event.deadlineAt).getTime() - Date.now())
            });
          }
          if (event.type === "round_settled") {
            setTurnTimer(null);
          }
          if (event.type === "bot_ai_stream") {
            setThinking((current) => reduceThinking(current, event));
            return;
          }
          if (event.type === "bot_decision_failed") {
            setThinking((current) => reduceBotDecisionFailed(current, event));
            return;
          }
          if (event.type === "commentary") {
            commentarySeq.current += 1;
            setCommentary({ text: event.text, tag: event.tag, seq: commentarySeq.current });
            return;
          }
          setEvents((items) => [event, ...items].slice(0, 16));
        }
      }),
    [input.botReasoningEffort, input.code, input.lineup, input.session.accessToken, input.session.user.id]
  );

  useEffect(() => {
    void client.connect();
    return () => {
      client.disconnect();
    };
  }, [client]);

  // 断线自动重连：2s 间隔重试至 15s；直播房关闭后重连必败，超时即标记直播结束
  useEffect(() => {
    if (reconnectRequest === null) {
      return;
    }

    let cancelled = false;
    const deadline = reconnectRequest + RECONNECT_DEADLINE_MS;
    const run = async (): Promise<void> => {
      while (!cancelled && Date.now() < deadline) {
        if (await client.connect()) {
          if (!cancelled) {
            setReconnectRequest(null);
          }
          return;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, RECONNECT_RETRY_MS);
        });
      }
      if (!cancelled) {
        setReconnectRequest(null);
        setEnded("直播已结束");
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [client, reconnectRequest]);

  useTurnTimerTicker(turnTimer, setTurnTimer);

  return { status, snapshot, events, thinking, commentary, ended, turnTimer };
}
