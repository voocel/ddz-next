import type { GameSnapshotDto } from "@ddz/protocol";
import type { BotThinkingState } from "../../botThinking";

/**
 * 行动位头顶的思考云:实时滚动当前思考流的最后一截,给牌桌留住"这家伙正在嘀咕"的拟人现场感。
 * 完整思考仍在右侧栏——云朵只做氛围,单行、只跟当前行动位,出牌后随 active=false 收起。
 */
export function SeatThinkCloud({
  snapshot,
  thinking,
  localPlayerId
}: {
  readonly snapshot: GameSnapshotDto | null;
  readonly thinking: BotThinkingState;
  readonly localPlayerId: string;
}) {
  const actorId = snapshot?.currentPlayerId ?? null;
  const entry = actorId ? thinking[actorId] : undefined;
  if (!snapshot || !actorId || !entry?.active) {
    return null;
  }

  const raw = entry.channels.reasoning || entry.channels.text;
  const tail = raw.replace(/\s+/g, " ").trim().slice(-48) || "AI开始分析...";

  const localSeat = snapshot.players.find((player) => player.id === localPlayerId)?.seat ?? null;
  const actor = snapshot.players.find((player) => player.id === actorId);
  const actorSeat = actor?.seat ?? null;
  if (actorSeat === null) {
    return null;
  }
  const relative = localSeat === null ? actorSeat : (actorSeat - localSeat + 3) % 3;
  // 本地真人位不会有思考流(thinking 只收 bot 的 bot_ai_stream),防御性跳过
  if (relative === 0 && localSeat !== null) {
    return null;
  }
  const side = relative === 0 ? "bottom" : relative === 1 ? "right" : "left";

  return (
    <div className="seat-cloud-layer" aria-hidden="true">
      <div className={`seat-cloud seat-cloud--${side}`}>
        <span className="seat-cloud-ai">AI</span>
        <span className="seat-cloud-name">{actor?.nickname ?? "机器人"}</span>
        <span className="seat-cloud-text">
          <span dir="ltr">{tail}</span>
        </span>
      </div>
    </div>
  );
}
