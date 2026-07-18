import type { CSSProperties } from "react";
import { aiTracePayloadSchema, type RoundReplayDto } from "@ddz/protocol";
import { modelProfile } from "../../modelProfiles";

interface ReplayReasoningPanelProps {
  readonly replay: RoundReplayDto;
  readonly step: number;
}

/** 复盘 AI 思考面板：展示当前步动作留证的决策 trace（模型、耗时、reasoning 全文）；无留证步给占位卡 */
export function ReplayReasoningPanel({ replay, step }: ReplayReasoningPanelProps) {
  const action = replay.actions[Math.min(Math.max(step, 0), Math.max(0, replay.actions.length - 1))];
  const trace = action ? aiTracePayloadSchema.safeParse(action.payload.aiTrace) : null;
  if (!action?.playerId || !trace?.success) {
    return (
      <aside className="replay-reasoning">
        <p className="replay-reasoning-empty">该步无 AI 思考记录</p>
      </aside>
    );
  }

  const player = replay.players.find((item) => item.playerId === action.playerId);
  const profile = modelProfile(trace.data.model, player?.model?.provider ?? "");
  return (
    <aside className="replay-reasoning" style={{ "--ai-accent": profile.accent } as CSSProperties}>
      <header className="replay-reasoning-head">
        <img className="replay-reasoning-avatar" src={profile.avatar} alt={profile.alias} />
        <div className="replay-reasoning-title">
          <strong>{player?.nickname ?? profile.alias}</strong>
          <span>
            {trace.data.model} · {(trace.data.latencyMs / 1000).toFixed(1)}s
          </span>
        </div>
      </header>
      {trace.data.reasoningText ? (
        <div className="replay-reasoning-body">{trace.data.reasoningText}</div>
      ) : (
        <p className="replay-reasoning-empty">该步未留存思考过程</p>
      )}
    </aside>
  );
}
