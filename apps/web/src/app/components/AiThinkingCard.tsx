import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { GameSnapshotDto } from "@ddz/protocol";
import type { BotThinkingEntry } from "../../botThinking";
import { modelProfile } from "../../modelProfiles";

type SnapshotPlayer = GameSnapshotDto["players"][number];

interface AiThinkingCardProps {
  readonly player: SnapshotPlayer;
  /** 该席位的思考流(可能尚无输出);undefined 渲染等待态 */
  readonly entry: BotThinkingEntry | undefined;
  readonly snapshot: GameSnapshotDto | null;
  /** 显示局内 meta 行(剩牌/累计分),竞技场观战用 */
  readonly showMeta?: boolean;
  /** 传入即在错误块提供重试按钮(挑战桌真人可代 bot 重试);观战场景不传 */
  readonly onRetryBotTurn?: (() => void) | undefined;
}

/** LLM 席位思考直播卡:选手头像/品牌色、相位徽章、流式正文、决策 chip;挑战桌与竞技场共用(差异经 props)。 */
export function AiThinkingCard({ player, entry, snapshot, showMeta = false, onRetryBotTurn }: AiThinkingCardProps) {
  const profile = modelProfile(player.model?.model ?? player.nickname ?? "", player.model?.provider);
  const badge = entry ? statusBadge(snapshot, player.id, entry) : null;
  const isCurrent = snapshot?.currentPlayerId === player.id;
  const className = [
    "bot-think-card",
    entry?.active ? "is-active" : "",
    isCurrent ? "is-current" : "",
    entry?.error ? "has-error" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className} style={{ "--ai-accent": profile.accent } as CSSProperties}>
      <header className="bot-think-head">
        <img className="bot-think-avatar" src={profile.avatar} alt="" />
        <div className="bot-think-title">
          <strong>{player.nickname ?? profile.alias}</strong>
          <span>{player.model?.model ?? profile.tagline}</span>
        </div>
        {snapshot?.landlordId === player.id ? <em className="bot-think-role">地主</em> : null}
        {badge ? <em className={`bot-think-badge${entry?.error ? " is-error" : ""}`}>{badge}</em> : null}
      </header>
      {showMeta ? (
        <div className="bot-think-meta">
          <span>剩 {player.handCount} 张</span>
          <span>{player.score} 分</span>
        </div>
      ) : null}
      <ThinkingBody entry={entry} />
      {entry?.choice ? <div className="bot-think-choice">✓ {entry.choice.label}</div> : null}
      {entry?.error ? (
        <div className="bot-think-error">
          <span>{entry.error.message}</span>
          {onRetryBotTurn ? (
            <button
              type="button"
              className="bot-think-retry"
              disabled={!entry.error.retryable || entry.active}
              onClick={onRetryBotTurn}
            >
              重新请求
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 流式正文：思考/输出两个 channel 顺序展示，活跃时尾部带闪烁光标并自动贴底滚动 */
function ThinkingBody({ entry }: { readonly entry: BotThinkingEntry | undefined }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const reasoning = entry?.channels.reasoning ?? "";
  const output = entry?.channels.text ?? "";
  const active = entry?.active === true;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [reasoning, output, active]);

  const caret = active ? <span className="bot-think-caret" aria-hidden="true" /> : null;
  return (
    <div ref={bodyRef} className="bot-think-body">
      {!reasoning && !output ? (
        <p className="bot-think-idle">{active ? <>正在接入模型…{caret}</> : "等待出手"}</p>
      ) : (
        <>
          {reasoning ? (
            <section className="bot-think-section">
              <div className="bot-think-label">思考</div>
              <div>
                {reasoning}
                {!output ? caret : null}
              </div>
            </section>
          ) : null}
          {output ? (
            <section className="bot-think-section">
              <div className="bot-think-label">输出</div>
              <div>
                {output}
                {caret}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** 头部状态徽章：出错 > 当前回合相位 > 思考中；空闲(已冻结回看)不显示 */
function statusBadge(snapshot: GameSnapshotDto | null, playerId: string, entry: BotThinkingEntry): string | null {
  if (entry.error) {
    return "出错";
  }
  if (!entry.active) {
    return null;
  }
  if (snapshot?.currentPlayerId === playerId) {
    switch (snapshot.phase) {
      case "bidding":
        return "叫地主中";
      case "robbing":
        return "抢地主中";
      case "playing":
        return "出牌中";
      default:
        break;
    }
  }
  return "思考中";
}
