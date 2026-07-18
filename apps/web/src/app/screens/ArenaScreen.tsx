import { Suspense, lazy, useEffect, useRef, type CSSProperties } from "react";
import type { BotModelRefDto, GameSnapshotDto, LoginResponse } from "@ddz/protocol";
import type { AudioLevels } from "../../audio";
import type { ReasoningEffort } from "../../botPreferences";
import type { ThemeId } from "../../theme";
import type { BotThinkingEntry } from "../../botThinking";
import { modelProfile } from "../../modelProfiles";
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
            <ArenaSeatPanel
              key={player.id}
              player={player}
              entry={arena.thinking[player.id]}
              landlordId={arena.snapshot?.landlordId ?? null}
              isCurrent={arena.snapshot?.currentPlayerId === player.id}
            />
          ))}
        </aside>
      ) : null}
    </main>
  );
}

type ArenaPlayer = GameSnapshotDto["players"][number];

function ArenaSeatPanel({
  player,
  entry,
  landlordId,
  isCurrent
}: {
  readonly player: ArenaPlayer;
  readonly entry: BotThinkingEntry | undefined;
  readonly landlordId: string | null;
  readonly isCurrent: boolean;
}) {
  const profile = modelProfile(player.model?.model ?? player.nickname ?? "", player.model?.provider);
  const reasoning = entry ? entry.channels.reasoning || entry.channels.text : "";
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 直播 reasoning 持续增长，保持滚动条贴底跟随最新输出
  useEffect(() => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [reasoning]);

  return (
    <section
      className={`arena-panel${isCurrent ? " is-current" : ""}${entry?.active ? " is-active" : ""}`}
      style={{ "--ai-accent": profile.accent } as CSSProperties}
    >
      <header className="arena-panel-head">
        <img src={profile.avatar} alt="" />
        <div className="arena-panel-title">
          <strong>{player.nickname ?? profile.alias}</strong>
          <span>{player.model ? player.model.model : profile.tagline}</span>
        </div>
        {landlordId === player.id ? <em className="arena-panel-role">地主</em> : null}
      </header>
      <div className="arena-panel-meta">
        <span>剩 {player.handCount} 张</span>
        <span>{player.score} 分</span>
        {entry?.active ? <span className="arena-panel-live">思考中…</span> : null}
      </div>
      <div ref={bodyRef} className="arena-panel-body">
        {reasoning || (entry?.active ? "…" : "等待出手")}
        {entry?.active ? <span className="bot-think-caret" aria-hidden="true" /> : null}
      </div>
      {entry?.choice ? <div className="arena-panel-choice">出手 {entry.choice.index + 1}: {entry.choice.label}</div> : null}
      {entry?.error ? <div className="arena-panel-error">{entry.error.message}</div> : null}
    </section>
  );
}
