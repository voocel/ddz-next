import type { AuthUserDto, RoundHistoryActionDto, RoundHistoryItemDto } from "@ddz/protocol";
import type { TurnTimerState } from "./types";

export function formatUser(user: AuthUserDto): string {
  return `${user.nickname} / ${user.username}`;
}

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

export function formatTurnTimer(timer: TurnTimerState, localPlayerId: string): string {
  const seconds = Math.ceil(timer.remainingMs / 1000);
  const owner = timer.playerId === localPlayerId ? "你" : shortId(timer.playerId);
  return `${owner} ${seconds}s`;
}

export function formatActionType(type: RoundHistoryActionDto["type"]): string {
  const labels: Record<RoundHistoryActionDto["type"], string> = {
    landlord_bid: "叫地主",
    landlord_robbed: "抢地主",
    cards_played: "出牌",
    player_passed: "过牌",
    round_started: "开局",
    round_settled: "结算"
  };
  return labels[type];
}

export function formatReplayAction(action: RoundHistoryActionDto): string {
  const actor = action.playerId ?? "系统";
  if (action.type === "cards_played") {
    return `${actor} ${formatPayloadValue(action.payload.cards)}`;
  }
  if (action.type === "round_settled") {
    return `${actor} 完成结算`;
  }
  if (action.type === "landlord_bid" && typeof action.payload.called === "boolean") {
    return `${actor} ${action.payload.called ? "叫" : "不叫"}`;
  }
  if (action.type === "landlord_robbed" && typeof action.payload.robbed === "boolean") {
    return `${actor} ${action.payload.robbed ? "抢" : "不抢"}`;
  }
  return actor;
}

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function formatPayloadValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
