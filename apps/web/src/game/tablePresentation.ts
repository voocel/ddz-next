import type { GameEvent, GameSnapshotDto, RoundHistoryActionDto } from "@ddz/protocol";
import { combinationKindLabel } from "./playValidation";

const PHASE_LABELS: Record<GameSnapshotDto["phase"], string> = {
  waiting: "等待入座",
  ready: "准备阶段",
  bidding: "叫地主",
  robbing: "抢地主",
  playing: "出牌阶段",
  settled: "本局结算"
};

export function describeSnapshotStatus(snapshot: GameSnapshotDto, localPlayerId: string): string {
  const readyCount = snapshot.players.filter((player) => player.ready).length;
  const actor = (playerId: string): string => formatActor(playerId, localPlayerId, snapshotNickname(snapshot, playerId));
  const current = snapshot.currentPlayerId ? actor(snapshot.currentPlayerId) : "-";
  const landlord = snapshot.landlordId ? actor(snapshot.landlordId) : "-";
  const candidate = snapshot.bidCandidateId ? actor(snapshot.bidCandidateId) : "-";
  const offlinePlayers = snapshot.players
    .filter((player) => !player.connected)
    .map((player) => formatActor(player.id, localPlayerId, player.nickname));
  const offlineText = offlinePlayers.length ? `  离线: ${offlinePlayers.join(", ")}` : "";

  return [
    `阶段: ${PHASE_LABELS[snapshot.phase]}`,
    `当前: ${current}`,
    `地主: ${landlord}`,
    `候选: ${candidate}`,
    `准备: ${readyCount}/${snapshot.players.length}`
  ].join("  ") + offlineText;
}

export function describePhasePrompt(snapshot: GameSnapshotDto, localPlayerId: string): string {
  const localPlayer = snapshot.players.find((player) => player.id === localPlayerId);
  const current = snapshot.currentPlayerId
    ? formatActor(snapshot.currentPlayerId, localPlayerId, snapshotNickname(snapshot, snapshot.currentPlayerId))
    : "-";

  switch (snapshot.phase) {
    case "waiting":
      return "等待玩家入座";
    case "ready":
      return localPlayer?.ready ? "等待其他玩家准备" : "点击准备开始";
    case "bidding":
      return snapshot.currentPlayerId === localPlayerId ? "轮到你叫地主" : `等待 ${current} 叫地主`;
    case "robbing":
      return snapshot.currentPlayerId === localPlayerId ? "轮到你抢地主" : `等待 ${current} 抢地主`;
    case "playing":
      return snapshot.currentPlayerId === localPlayerId ? "轮到你出牌" : `等待 ${current} 出牌`;
    case "settled":
      return snapshot.settlement
        ? `本局结束，赢家 ${formatActor(snapshot.settlement.winnerId, localPlayerId, snapshotNickname(snapshot, snapshot.settlement.winnerId))}`
        : "本局结束";
  }
}

export function describeEventFeedback(event: GameEvent, localPlayerId: string): string | null {
  const actor = (playerId: string, snapshot: GameSnapshotDto): string =>
    formatActor(playerId, localPlayerId, snapshotNickname(snapshot, playerId));

  switch (event.type) {
    case "snapshot":
    case "turn_timer":
    case "player_connection_changed":
      return null;
    case "player_joined":
      return `${actor(event.playerId, event.snapshot)} 入座`;
    case "player_ready":
      return `${actor(event.playerId, event.snapshot)} 已准备`;
    case "round_started":
      return "新一局开始，发牌";
    case "landlord_bid":
      return `${actor(event.playerId, event.snapshot)} ${event.called ? "叫地主" : "不叫"}`;
    case "landlord_robbed":
      return `${actor(event.playerId, event.snapshot)} ${event.robbed ? "抢地主" : "不抢"}`;
    case "cards_played":
      return `${actor(event.play.playerId, event.snapshot)} 出牌 ${combinationKindLabel(event.play.combination.kind)}`;
    case "player_passed":
      return `${actor(event.playerId, event.snapshot)} 过牌`;
    case "round_settled":
      return `本局结算，赢家 ${actor(event.settlement.winnerId, event.snapshot)}`;
    case "command_rejected":
      return `命令被拒绝: ${event.reason}`;
    case "room_failed":
      return `房间故障: ${event.reason}`;
  }
}

export function describeSettlement(snapshot: GameSnapshotDto, localPlayerId: string): readonly string[] {
  if (!snapshot.settlement) {
    return [];
  }

  const actor = (playerId: string): string => formatActor(playerId, localPlayerId, snapshotNickname(snapshot, playerId));

  return [
    `赢家 ${actor(snapshot.settlement.winnerId)}`,
    `地主 ${actor(snapshot.settlement.landlordId)}`,
    `倍数 x${snapshot.settlement.multiplier}${snapshot.settlement.spring ? "（春天）" : ""}`,
    ...snapshot.settlement.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((player) => {
        const role = player.role === "landlord" ? "地主" : "农民";
        return `${actor(player.playerId)}  ${role}  ${formatScore(player.scoreDelta)}  总分 ${player.totalScore}`;
      })
  ];
}

export function formatActor(playerId: string, localPlayerId: string, nickname?: string): string {
  if (playerId === localPlayerId) {
    return "你";
  }

  if (playerId.startsWith("bot:")) {
    const index = playerId.split(":").at(-1);
    return `机器人${index ?? ""}`;
  }

  return nickname ?? shortId(playerId);
}

/** 从快照玩家列表里查展示昵称；旧快照无该字段时返回 undefined，由 formatActor 兜底 */
function snapshotNickname(snapshot: GameSnapshotDto, playerId: string): string | undefined {
  return snapshot.players.find((player) => player.id === playerId)?.nickname;
}

export function formatScore(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

export function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

export function formatReplayAction(action: RoundHistoryActionDto, resolveActor?: (playerId: string) => string): string {
  const actor = action.playerId ? (resolveActor ?? shortId)(action.playerId) : "系统";
  switch (action.type) {
    case "round_started":
      return "开局发牌";
    case "landlord_bid":
      return `${actor} ${action.payload.called === true ? "叫地主" : "不叫"}`;
    case "landlord_robbed":
      return `${actor} ${action.payload.robbed === true ? "抢地主" : "不抢"}`;
    case "cards_played":
      return `${actor} 出牌 ${parseReplayCardIds(action.payload.cards).map(formatCardId).join(" ")}`;
    case "player_passed":
      return `${actor} 过牌`;
    case "round_settled":
      return `${actor} 完成结算`;
  }
}

export function parseReplayCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function formatCardId(cardId: string): string {
  if (cardId === "SJ") {
    return "小王";
  }
  if (cardId === "BJ") {
    return "大王";
  }

  const [rank, suit] = cardId.split("-");
  const suitText = suit === "hearts" ? "♥" : suit === "diamonds" ? "♦" : suit === "spades" ? "♠" : "♣";
  return `${rank ?? cardId}${suit ? suitText : ""}`;
}

export function isRedCardId(cardId: string): boolean {
  return cardId.includes("-hearts") || cardId.includes("-diamonds") || cardId === "BJ";
}
