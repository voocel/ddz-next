import type { GameSnapshotDto } from "@ddz/protocol";
import { hasBotAiStreamText, type BotThinkingEntry, type BotThinkingState } from "../../botThinking";
import { AiThinkingCard } from "./AiThinkingCard";

interface AiDockProps {
  readonly thinking: BotThinkingState;
  readonly snapshot: GameSnapshotDto | null;
  readonly localPlayerId: string;
  readonly onRetryBotTurn: () => void;
}

/**
 * AI 思考侧栏：与 Phaser 舞台分栏的常驻停靠区（.table-screen 网格右列），绝不遮挡牌桌。
 * 为每个产生过输出的 LLM 席位渲染一张思考直播卡（实时流式滚动，done 后冻结保留供回看）；
 * 无内容时整栏不渲染，布局列自动收起（规则 bot 房/纯真人房不占空间）。
 */
export function AiDock({ thinking, snapshot, localPlayerId, onRetryBotTurn }: AiDockProps) {
  if (!snapshot) {
    return null;
  }
  const cards = liveCards(thinking, snapshot, localPlayerId);
  if (cards.length === 0) {
    return null;
  }

  return (
    <aside className="ai-dock" aria-live="polite">
      {cards.map((card) => (
        <AiThinkingCard
          key={card.player.id}
          player={card.player}
          entry={card.entry}
          snapshot={snapshot}
          onRetryBotTurn={onRetryBotTurn}
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
