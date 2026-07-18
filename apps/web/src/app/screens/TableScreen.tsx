import { Suspense, lazy, type RefObject } from "react";
import { AiDock } from "../components/AiDock";
import { TableOverlay } from "../components/TableOverlay";
import type { PhaserTableHandle } from "../../PhaserTable";
import type { DdzApp } from "../useDdzApp";

const PhaserTable = lazy(async () => {
  const module = await import("../../PhaserTable");
  return {
    default: module.PhaserTable
  };
});

export function TableScreen({
  app,
  tableRef,
  onOpenSettings
}: {
  app: DdzApp;
  tableRef: RefObject<PhaserTableHandle | null>;
  onOpenSettings: () => void;
}) {
  const {
    session,
    events,
    handlePass,
    handlePlay,
    selectedReplay,
    replayStep,
    theme,
    audioLevels
  } = app;

  // 牌桌仅在已登录时渲染（App 已据 session 分屏），此处守卫满足类型收窄
  if (!session) {
    return null;
  }

  return (
    <main className="table-screen">
      <section className="table-stage">
        <Suspense fallback={<section className="game-host loading-host">加载牌桌</section>}>
          <PhaserTable
            ref={tableRef}
            events={events}
            localPlayerId={session.user.id}
            onPass={handlePass}
            replay={selectedReplay}
            replayStep={replayStep}
            theme={theme}
            audioLevels={audioLevels}
            onPlay={handlePlay}
          />
        </Suspense>

        <TableOverlay app={app} tableRef={tableRef} onOpenSettings={onOpenSettings} />
      </section>

      <AiDock app={app} />
    </main>
  );
}
