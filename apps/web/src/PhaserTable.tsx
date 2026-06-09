import { useEffect, useRef } from "react";
import type { CardId } from "@ddz/domain";
import type { GameEvent, RoundReplayDto } from "@ddz/protocol";
import { createTableGame } from "./game/createTableGame";
import type { TableGameBridge } from "./game/TableScene";

interface PhaserTableProps {
  readonly events: readonly GameEvent[];
  readonly localPlayerId: string;
  readonly onPass: () => void;
  readonly replay: RoundReplayDto | null;
  readonly replayStep: number;
  readonly onPlay: (cards: readonly CardId[]) => void;
}

export function PhaserTable({ events, localPlayerId, onPass, replay, replayStep, onPlay }: PhaserTableProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<TableGameBridge | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const tableGame = createTableGame(hostRef.current, {
      localPlayerId,
      onPass,
      onPlay
    });

    bridgeRef.current = tableGame.bridge;

    return () => {
      tableGame.destroy();
      bridgeRef.current = null;
    };
  }, [localPlayerId, onPass, onPlay]);

  useEffect(() => {
    if (replay) {
      return;
    }

    const latestEvent = events[0];
    if (!latestEvent) {
      return;
    }

    bridgeRef.current?.applyEvent(latestEvent);
  }, [events, replay]);

  useEffect(() => {
    bridgeRef.current?.applyReplay(replay, replayStep);
  }, [replay, replayStep]);

  return <section ref={hostRef} className="game-host" />;
}
