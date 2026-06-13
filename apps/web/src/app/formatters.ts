import type { RoundHistoryItemDto } from "@ddz/protocol";

export function formatRoundDelta(round: RoundHistoryItemDto, userId: string): string {
  const player = round.players.find((item) => item.playerId === userId);
  return player ? formatDelta(player.coinDelta) : "-";
}

export function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
