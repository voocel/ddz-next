import { Suspense, lazy, type RefObject } from "react";
import type { AudioLevels } from "../../audio";
import type { ThemeId } from "../../theme";
import { AiDock } from "../components/AiDock";
import { TableOverlay } from "../components/TableOverlay";
import type { PhaserTableHandle } from "../../PhaserTable";
import type { RoomSession } from "../useRoomSession";

const PhaserTable = lazy(async () => {
  const module = await import("../../PhaserTable");
  return {
    default: module.PhaserTable
  };
});

interface TableScreenProps {
  readonly room: RoomSession;
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly tableRef: RefObject<PhaserTableHandle | null>;
  readonly onLeave: () => void;
  readonly onOpenSettings: () => void;
}

/** 挑战桌实况屏：Phaser 舞台 + DOM 覆盖层 + AI 思考侧栏（回放另走 ReplayScreen） */
export function TableScreen({ room, localPlayerId, theme, audioLevels, tableRef, onLeave, onOpenSettings }: TableScreenProps) {
  return (
    <main className="table-screen">
      <section className="table-stage">
        <Suspense fallback={<section className="game-host loading-host">加载牌桌</section>}>
          <PhaserTable
            ref={tableRef}
            events={room.events}
            localPlayerId={localPlayerId}
            onPass={() => room.client.pass()}
            replay={null}
            replayStep={0}
            theme={theme}
            audioLevels={audioLevels}
            onPlay={(cards) => room.client.playCards(cards)}
          />
        </Suspense>

        <TableOverlay
          room={room}
          localPlayerId={localPlayerId}
          theme={theme}
          tableRef={tableRef}
          onLeave={onLeave}
          onOpenSettings={onOpenSettings}
        />
      </section>

      <AiDock
        thinking={room.thinking}
        snapshot={room.snapshot}
        localPlayerId={localPlayerId}
        onRetryBotTurn={() => room.client.retryBotTurn()}
      />
    </main>
  );
}
