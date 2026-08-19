import { useEffect, useMemo, useRef, useState } from "react";
import type { BotModelRefDto, GameEvent, GameSnapshotDto, LoginResponse } from "@ddz/protocol";
import { createGameClient, isRecoverableDropCode } from "../net/gameClient";
import { reduceBotDecisionFailed, reduceThinking, EMPTY_THINKING, type BotThinkingState } from "../botThinking";
import type { TurnTimerState } from "./types";
import { useTurnTimerTicker } from "./useTurnTimerTicker";

const RECONNECT_RETRY_MS = 2_000;
const RECONNECT_DEADLINE_MS = 15_000;

interface GameRoomCoreInput {
  readonly code: string;
  readonly session: LoginResponse;
  /** true 以观众身份入房（不占座） */
  readonly spectate?: boolean;
  /** true 创建竞技场房（随 lineup 首次建房生效） */
  readonly arena?: boolean;
  /** true 入房自动准备（挑战桌/人机房） */
  readonly quickStart?: boolean;
  /** 建房阵容（joinOrCreate 首次创建时生效；进入已存在的房传 null） */
  readonly lineup: readonly BotModelRefDto[] | null;
  readonly reasoningEffort: string | null;
  /** 公共归约之外的事件旁路（解说字幕/战绩刷新等）；返回 true 表示已消费，不再进 events 反馈行 */
  readonly onEvent?: (event: GameEvent) => boolean;
  /** 房间终结（被踢/房间故障/重连超时）：去向与文案交调用方 */
  readonly onEnded: (reason: string) => void;
}

/**
 * 房间连接核心：挂载即连接、卸载即断开（后退离房/切房的结构保证），
 * 断线自动重连与 snapshot/turn_timer/AI 输出流的公共归约唯一定义处。
 * 观战（useArenaSpectator）与入座（useRoomSession）都以它为引擎。
 */
export function useGameRoomCore(input: GameRoomCoreInput) {
  const [status, setStatus] = useState("连接中");
  const [snapshot, setSnapshot] = useState<GameSnapshotDto | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  // 大模型「AI 输出流」:按 playerId 累积各机器人的实时 reasoning/text,供座位气泡与思考卡展示。
  const [thinking, setThinking] = useState<BotThinkingState>(EMPTY_THINKING);
  const [turnTimer, setTurnTimer] = useState<TurnTimerState | null>(null);
  // 断线自动重连：记录触发时间戳，副作用循环按 deadline 重试（游戏服重启恢复牌局的入口）
  const [reconnectRequest, setReconnectRequest] = useState<number | null>(null);

  // 回调经 ref 透传：调用方每次渲染新建闭包也不重建 client（重建即断线重连）
  const onEventRef = useRef(input.onEvent);
  const onEndedRef = useRef(input.onEnded);
  useEffect(() => {
    onEventRef.current = input.onEvent;
    onEndedRef.current = input.onEnded;
  });

  const client = useMemo(
    () =>
      createGameClient({
        endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
        playerId: input.session.user.id,
        accessToken: input.session.accessToken,
        roomCode: input.code,
        quickStart: input.quickStart === true,
        ...(input.spectate ? { spectate: true } : {}),
        ...(input.arena ? { arena: true } : {}),
        lineup: input.lineup,
        reasoningEffort: input.reasoningEffort,
        onStatus: setStatus,
        onDropped: (code) => {
          // 被踢/房间故障：重连必败或会互踢，直接判定终结
          if (!isRecoverableDropCode(code)) {
            onEndedRef.current(`房间连接已断开 (${code})`);
            return;
          }
          // 网络抖动或游戏服重启：自动重连，服务端会恢复牌局并补发快照
          setStatus("连接已断开，正在重连…");
          setReconnectRequest(Date.now());
        },
        onEvent: (event) => {
          if ("snapshot" in event) {
            setSnapshot(event.snapshot);
            // 回合推进到的玩家与当前倒计时归属不一致时,先清掉旧倒计时:真人回合会紧跟一条 turn_timer 重新点亮;
            // bot 回合服务端不发 turn_timer(bot 不受规则型回合超时管辖,由自身决策超时管),于是保持无倒计时。
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
            // AI 输出流不进 events 反馈行(它走座位气泡),避免刷屏挤掉真正的出牌/提示反馈。
            setThinking((current) => reduceThinking(current, event));
            return;
          }
          if (event.type === "bot_decision_failed") {
            setThinking((current) => reduceBotDecisionFailed(current, event));
            return;
          }
          if (onEventRef.current?.(event)) {
            return;
          }
          setEvents((items) => [event, ...items].slice(0, 16));
        }
      }),
    [
      input.arena,
      input.code,
      input.lineup,
      input.quickStart,
      input.reasoningEffort,
      input.session.accessToken,
      input.session.user.id,
      input.spectate
    ]
  );

  useEffect(() => {
    void client.connect();
    return () => {
      client.disconnect();
    };
  }, [client]);

  // 断线自动重连：2s 间隔重试至 15s；成功则服务端补发快照无缝恢复，超时判定房间终结
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
        onEndedRef.current("重连失败");
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [client, reconnectRequest]);

  useTurnTimerTicker(turnTimer, setTurnTimer);

  return { client, status, snapshot, events, thinking, turnTimer, reconnecting: reconnectRequest !== null };
}

export type GameRoomCore = ReturnType<typeof useGameRoomCore>;
