import { Suspense, lazy } from "react";
import type { BotModelRefDto, LoginResponse } from "@ddz/protocol";
import type { AudioLevels } from "../../audio";
import type { ReasoningEffort } from "../../lineupDefaults";
import type { ThemeId } from "../../theme";
import { AiThinkingCard } from "../components/AiThinkingCard";
import { SeatThinkCloud } from "../components/SeatThinkCloud";
import { SeatTurnClock } from "../components/SeatTurnClock";
import { useArenaSpectator } from "../useArenaSpectator";

const PhaserTable = lazy(async () => {
  const module = await import("../../PhaserTable");
  return {
    default: module.PhaserTable
  };
});

// 观众没有出牌操作：Phaser 的命令回调挂空实现
const noop = (): void => {};

interface ArenaScreenProps {
  readonly code: string;
  readonly session: LoginResponse;
  readonly lineup: readonly BotModelRefDto[] | null;
  /** 创建方所选思考强度（与 lineup 同经路由 state 携带）；观战已有直播为 null */
  readonly botReasoningEffort: ReasoningEffort | null;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly onOpenSettings: () => void;
  readonly onExit: () => void;
}

/** 竞技场观战页：Phaser 舞台（公开视角）+ 三席位 reasoning 面板 + 解说字幕条 */
export function ArenaScreen({
  code,
  session,
  lineup,
  botReasoningEffort,
  theme,
  audioLevels,
  onOpenSettings,
  onExit
}: ArenaScreenProps) {
  const arena = useArenaSpectator({ code, session, lineup, botReasoningEffort });
  const players = [...(arena.snapshot?.players ?? [])].sort((left, right) => left.seat - right.seat);

  return (
    <main className="table-screen arena-screen">
      <section className="table-stage">
        <Suspense fallback={<section className="game-host loading-host">加载牌桌</section>}>
          <PhaserTable
            events={arena.events}
            localPlayerId={session.user.id}
            onPass={noop}
            replay={null}
            replayStep={0}
            theme={theme}
            audioLevels={audioLevels}
            onPlay={noop}
          />
        </Suspense>

        <SeatThinkCloud snapshot={arena.snapshot} thinking={arena.thinking} localPlayerId={session.user.id} />
        <SeatTurnClock
          snapshot={arena.snapshot}
          turnTimer={arena.turnTimer}
          localPlayerId={session.user.id}
          theme={theme}
        />

        <div className="table-hud">
          <span className="arena-live-badge">LIVE</span>
          <span className="arena-hud-chip">直播间 {code}</span>
          <span className="arena-hud-chip arena-hud-status">{arena.status}</span>
          <span className="hud-spacer" />
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onOpenSettings}>
            设置
          </button>
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onExit}>
            离开
          </button>
        </div>

        {arena.commentary ? (
          <div className="arena-commentary" key={arena.commentary.seq}>
            <span className="arena-commentary-badge">解说</span>
            <span>{arena.commentary.text}</span>
          </div>
        ) : null}

        {arena.ended ? (
          <div className="arena-ended">
            <div className="arena-ended-card">
              <p>{arena.ended}</p>
              <button type="button" className="btn-img btn-img-orange btn-img-sm" onClick={onExit}>
                返回大厅
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {players.length ? (
        <aside className="ai-dock">
          {players.map((player) => (
            <AiThinkingCard
              key={player.id}
              player={player}
              entry={arena.thinking[player.id]}
              snapshot={arena.snapshot}
              showMeta
            />
          ))}
        </aside>
      ) : null}
    </main>
  );
}
