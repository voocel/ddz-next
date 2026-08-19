import { Suspense, lazy, useState } from "react";
import type { GameEvent, RoundReplayDto } from "@ddz/protocol";
import type { AudioLevels } from "../../audio";
import type { ThemeId } from "../../theme";
import { ReplayReasoningPanel } from "../components/ReplayReasoningPanel";
import { useReplayPlayback } from "../useReplayPlayback";

const PhaserTable = lazy(async () => {
  const module = await import("../../PhaserTable");
  return {
    default: module.PhaserTable
  };
});

// 回放是纯只读舞台：无实时事件流、无出牌操作
const NO_EVENTS: readonly GameEvent[] = [];
const noop = (): void => {};

interface ReplayScreenProps {
  readonly replay: RoundReplayDto;
  readonly localPlayerId: string;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  /** 退出去向文案由调用方定（在房间内=返回牌桌，否则=返回大厅） */
  readonly exitLabel: string;
  readonly onExit: () => void;
  readonly onOpenSettings: () => void;
}

/** 公开复盘页：Phaser 只读舞台 + 步进控制 dock + 当前步 AI 思考留证面板；步进/播放状态自持（key=roundId 重建） */
export function ReplayScreen({
  replay,
  localPlayerId,
  theme,
  audioLevels,
  exitLabel,
  onExit,
  onOpenSettings
}: ReplayScreenProps) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useReplayPlayback({
    replayPlaying: playing,
    replayStep: step,
    selectedReplay: replay,
    setReplayPlaying: setPlaying,
    setReplayStep: setStep
  });
  // 整局无任何思考留证（纯真人局/旧数据）时侧栏不占布局
  const hasTrace = replay.actions.some((action) => action.payload.aiTrace !== undefined);

  return (
    <main className="table-screen">
      <section className="table-stage">
        <Suspense fallback={<section className="game-host loading-host">加载牌桌</section>}>
          <PhaserTable
            events={NO_EVENTS}
            localPlayerId={localPlayerId}
            onPass={noop}
            replay={replay}
            replayStep={step}
            theme={theme}
            audioLevels={audioLevels}
            onPlay={noop}
          />
        </Suspense>

        <header className="table-hud">
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onExit}>
            ← 离开
          </button>
          <span className="table-chip">回放模式</span>
          <span className="hud-spacer" />
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onOpenSettings} aria-label="设置">
            ⚙️ 设置
          </button>
        </header>

        <div className="table-replay-dock">
          <span className="table-chip">
            回放 {Math.min(step + 1, replay.actions.length)}/{replay.actions.length}
          </span>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={replay.actions.length <= 1}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? "暂停" : "播放"}
          </button>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={step <= 0}
            onClick={() => {
              setPlaying(false);
              setStep((current) => Math.max(0, current - 1));
            }}
          >
            上一步
          </button>
          <button
            type="button"
            className="btn-img btn-img-wood btn-img-sm"
            disabled={step >= replay.actions.length - 1}
            onClick={() => {
              setPlaying(false);
              setStep((current) => Math.min(replay.actions.length - 1, current + 1));
            }}
          >
            下一步
          </button>
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onExit}>
            {exitLabel}
          </button>
        </div>
      </section>

      {hasTrace ? (
        <aside className="ai-dock">
          <ReplayReasoningPanel replay={replay} step={step} />
        </aside>
      ) : null}
    </main>
  );
}
