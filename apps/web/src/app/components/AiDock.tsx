import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { GameSnapshotDto } from "@ddz/protocol";
import { hasBotAiStreamText, type BotThinkingEntry, type BotThinkingState } from "../../botThinking";
import { modelProfile } from "../../modelProfiles";
import { ReplayReasoningPanel } from "./ReplayReasoningPanel";
import type { DdzApp } from "../useDdzApp";

/**
 * AI 思考侧栏：与 Phaser 舞台分栏的常驻停靠区（.table-screen 网格右列），绝不遮挡牌桌。
 * 直播时为每个产生过输出的 LLM 席位渲染一张思考直播卡（实时流式滚动，done 后冻结保留供回看）；
 * 回放时展示当前步的思考留证。无内容时整栏不渲染，布局列自动收起（规则 bot 房/纯真人房不占空间）。
 */
export function AiDock({ app }: { readonly app: DdzApp }) {
  const { session, selectedReplay, replayStep, thinking, snapshot, client } = app;
  if (!session) {
    return null;
  }

  if (selectedReplay) {
    // 整局无任何思考留证（纯真人局/旧数据）时不占布局
    if (!selectedReplay.actions.some((action) => action.payload.aiTrace !== undefined)) {
      return null;
    }
    return (
      <aside className="ai-dock">
        <ReplayReasoningPanel replay={selectedReplay} step={replayStep} />
      </aside>
    );
  }

  if (!snapshot) {
    return null;
  }
  const cards = liveCards(thinking, snapshot, session.user.id);
  if (cards.length === 0) {
    return null;
  }

  return (
    <aside className="ai-dock" aria-live="polite">
      {cards.map((card) => (
        <AiSeatCard
          key={card.player.id}
          player={card.player}
          entry={card.entry}
          snapshot={snapshot}
          onRetryBotTurn={() => client.retryBotTurn()}
        />
      ))}
    </aside>
  );
}

type SnapshotPlayer = GameSnapshotDto["players"][number];

function liveCards(
  thinking: BotThinkingState,
  snapshot: GameSnapshotDto,
  localPlayerId: string
): Array<{ player: SnapshotPlayer; entry: BotThinkingEntry }> {
  return Object.entries(thinking)
    .map(([playerId, entry]) => {
      const player = snapshot.players.find((item) => item.id === playerId);
      // 找不到玩家、无内容、或竟是本地玩家(理论上 bot 不会是自己)一律跳过
      if (!player || playerId === localPlayerId || !hasBotAiStreamText(entry)) {
        return null;
      }
      return { player, entry };
    })
    .filter((card): card is NonNullable<typeof card> => card !== null)
    .sort((left, right) => left.player.seat - right.player.seat);
}

/** 单个 LLM 席位的思考直播卡：选手头像/品牌色、相位徽章、流式正文、决策 chip、错误重试 */
function AiSeatCard({
  player,
  entry,
  snapshot,
  onRetryBotTurn
}: {
  readonly player: SnapshotPlayer;
  readonly entry: BotThinkingEntry;
  readonly snapshot: GameSnapshotDto;
  readonly onRetryBotTurn: () => void;
}) {
  const profile = modelProfile(player.model?.model ?? player.nickname ?? "", player.model?.provider);
  const badge = statusBadge(snapshot, player.id, entry);

  return (
    <section
      className={`bot-think-card${entry.active ? " is-active" : ""}${entry.error ? " has-error" : ""}`}
      style={{ "--ai-accent": profile.accent } as CSSProperties}
    >
      <header className="bot-think-head">
        <img className="bot-think-avatar" src={profile.avatar} alt="" />
        <div className="bot-think-title">
          <strong>{player.nickname ?? profile.alias}</strong>
          <span>{player.model?.model ?? profile.tagline}</span>
        </div>
        {badge ? <em className={`bot-think-badge${entry.error ? " is-error" : ""}`}>{badge}</em> : null}
      </header>
      <ThinkingBody entry={entry} />
      {entry.choice ? <div className="bot-think-choice">✓ {entry.choice.label}</div> : null}
      {entry.error ? (
        <div className="bot-think-error">
          <span>{entry.error.message}</span>
          <button
            type="button"
            className="bot-think-retry"
            disabled={!entry.error.retryable || entry.active}
            onClick={onRetryBotTurn}
          >
            重新请求
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** 流式正文：思考/输出两个 channel 顺序展示，活跃时尾部带闪烁光标并自动贴底滚动 */
function ThinkingBody({ entry }: { readonly entry: BotThinkingEntry }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const reasoning = entry.channels.reasoning;
  const output = entry.channels.text;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [reasoning, output, entry.active]);

  const caret = entry.active ? <span className="bot-think-caret" aria-hidden="true" /> : null;
  return (
    <div ref={bodyRef} className="bot-think-body">
      {!reasoning && !output ? (
        <p className="bot-think-idle">{entry.active ? <>正在接入模型…{caret}</> : "等待出手"}</p>
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
function statusBadge(snapshot: GameSnapshotDto, playerId: string, entry: BotThinkingEntry): string | null {
  if (entry.error) {
    return "出错";
  }
  if (!entry.active) {
    return null;
  }
  if (snapshot.currentPlayerId === playerId) {
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
