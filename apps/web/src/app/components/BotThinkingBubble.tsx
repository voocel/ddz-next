import { useLayoutEffect, useRef, useState } from "react";
import type { GameSnapshotDto } from "@ddz/protocol";
import { hasBotAiStreamText, type BotThinkingState } from "../../botThinking";

/**
 * 牌桌内大模型「AI 输出流」气泡覆盖层(React HTML,叠在 Phaser canvas 之上)。
 * thinking 的键即产生过 reasoning/text 的机器人 playerId;据其座位相对本地玩家的方位(左上/右上)定位气泡。
 * 默认折叠成「AI 输出中」,点击展开浮层看实时流式文本;done 后冻结保留,下一手新增量再覆盖。
 */
export function BotThinkingBubble({
  thinking,
  snapshot,
  localPlayerId
}: {
  thinking: BotThinkingState;
  snapshot: GameSnapshotDto | null;
  localPlayerId: string;
}) {
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  if (!snapshot) {
    return null;
  }
  const localSeat = snapshot.players.find((player) => player.id === localPlayerId)?.seat ?? null;

  const bubbles = Object.entries(thinking)
    .map(([playerId, entry]) => {
      const player = snapshot.players.find((item) => item.id === playerId);
      // 找不到玩家、无内容、或竟是本地座位(理论上 bot 不会是自己)一律跳过。
      if (!player || !hasBotAiStreamText(entry)) {
        return null;
      }
      const relative = localSeat === null ? player.seat : (player.seat - localSeat + 3) % 3;
      if (relative === 0) {
        return null;
      }
      return {
        playerId,
        name: player.nickname ?? "机器人",
        choice: entry.choice,
        reasoning: entry.channels.reasoning,
        output: entry.channels.text,
        preview: previewText(entry.choice ? `选择: ${entry.choice.label}` : entry.channels.text || entry.channels.reasoning),
        active: entry.active,
        side: relative === 1 ? ("right" as const) : ("left" as const)
      };
    })
    .filter((bubble): bubble is NonNullable<typeof bubble> => bubble !== null);

  if (bubbles.length === 0) {
    return null;
  }

  return (
    <div className="bot-think-layer" aria-live="polite">
      {bubbles.map((bubble) =>
        expandedPlayerId === bubble.playerId ? (
          <div key={bubble.playerId} className={`bot-think bot-think--${bubble.side}`}>
            <div className="bot-think-card">
              <div className="bot-think-head">
                <span className="bot-think-title">AI 输出 · {bubble.name}</span>
                <button
                  type="button"
                  className="bot-think-toggle"
                  onClick={() => setExpandedPlayerId(null)}
                  aria-label="收起 AI 输出"
                >
                  −
                </button>
              </div>
              <BotThinkingBody
                reasoning={bubble.reasoning}
                output={bubble.output}
                choice={bubble.choice}
                active={bubble.active}
              />
            </div>
          </div>
        ) : (
          <div key={bubble.playerId} className={`bot-think bot-think--${bubble.side}`}>
            <button
              type="button"
              className={`bot-think-preview${bubble.active ? " is-active" : ""}`}
              onClick={() => setExpandedPlayerId(bubble.playerId)}
              aria-label={`展开 ${bubble.name} 的 AI 输出`}
            >
              <span className="bot-think-preview-name">{bubble.name}</span>
              <span className="bot-think-preview-text">
                {bubble.preview}
                {bubble.active ? <span className="bot-think-preview-caret">▌</span> : null}
              </span>
            </button>
          </div>
        )
      )}
    </div>
  );
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) {
    return normalized || "AI 输出";
  }
  return `…${normalized.slice(-42)}`;
}

function BotThinkingBody({
  reasoning,
  output,
  choice,
  active
}: {
  readonly reasoning: string;
  readonly output: string;
  readonly choice: { readonly index: number; readonly label: string } | undefined;
  readonly active: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [reasoning, output, choice?.index, choice?.label, active]);

  return (
    <div ref={bodyRef} className="bot-think-body">
      {reasoning ? (
        <section className="bot-think-section">
          <div className="bot-think-label">思考</div>
          <div>{reasoning}</div>
        </section>
      ) : null}
      {output ? (
        <section className="bot-think-section">
          <div className="bot-think-label">输出</div>
          <div>{output}</div>
        </section>
      ) : null}
      {choice ? (
        <section className="bot-think-section">
          <div className="bot-think-label">选择</div>
          <div>
            {choice.index}: {choice.label}
          </div>
        </section>
      ) : null}
      {active ? <span className="bot-think-caret">▌</span> : null}
    </div>
  );
}
