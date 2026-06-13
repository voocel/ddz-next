import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CardId } from "@ddz/domain";
import type { GameEvent, RoundReplayDto } from "@ddz/protocol";
import { createTableGame } from "./game/createTableGame";
import type { TableGameBridge } from "./game/TableScene";
import type { ThemeId } from "./theme";

/** 暴露给 React 控制行的命令式接口：出牌/不出/提示依赖画布内的选牌状态，故经此触发 */
export interface PhaserTableHandle {
  play(): void;
  pass(): void;
  tip(): void;
}

interface PhaserTableProps {
  readonly events: readonly GameEvent[];
  readonly localPlayerId: string;
  readonly onPass: () => void;
  readonly replay: RoundReplayDto | null;
  readonly replayStep: number;
  readonly theme: ThemeId;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

export const PhaserTable = forwardRef<PhaserTableHandle, PhaserTableProps>(function PhaserTable(
  { events, localPlayerId, onPass, replay, replayStep, theme, onPlay },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<TableGameBridge | null>(null);
  const lastAppliedRef = useRef<GameEvent | null>(null);
  // 回调走 ref，避免父组件重建回调时反复销毁/重建 Phaser 场景
  const callbacksRef = useRef({ onPass, onPlay });
  callbacksRef.current = { onPass, onPlay };

  useImperativeHandle(
    ref,
    () => ({
      play: () => bridgeRef.current?.play(),
      pass: () => bridgeRef.current?.pass(),
      tip: () => bridgeRef.current?.tip()
    }),
    []
  );

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const tableGame = createTableGame(hostRef.current, {
      localPlayerId,
      theme,
      onPass: () => callbacksRef.current.onPass(),
      onPlay: (cards) => callbacksRef.current.onPlay(cards)
    });

    bridgeRef.current = tableGame.bridge;
    // 场景重建后重放全部事件
    lastAppliedRef.current = null;

    return () => {
      tableGame.destroy();
      bridgeRef.current = null;
    };
  }, [localPlayerId, theme]);

  useEffect(() => {
    if (replay) {
      // 回放期间直播事件只跟踪不应用（丢弃式），退出回放后不会重放过期事件
      lastAppliedRef.current = events[0] ?? null;
      return;
    }
    if (!events.length) {
      return;
    }

    // events 为最新在前；一个 React 批次可能合并多条事件，只放最新一条会丢失
    // 携带手牌的 round_started 等中间事件，因此按时间顺序补放所有未应用的事件。
    const pending: GameEvent[] = [];
    for (const event of events) {
      if (event === lastAppliedRef.current) {
        break;
      }
      pending.push(event);
    }

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      bridgeRef.current?.applyEvent(pending[index]!);
    }

    lastAppliedRef.current = events[0] ?? null;
  }, [events, replay]);

  useEffect(() => {
    bridgeRef.current?.applyReplay(replay, replayStep);
  }, [replay, replayStep]);

  return <section ref={hostRef} className="game-host" />;
});
