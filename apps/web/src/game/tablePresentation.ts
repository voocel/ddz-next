import type { GameEvent, GameSnapshotDto } from "@ddz/protocol";
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
  const current = snapshot.currentPlayerId ? formatActor(snapshot.currentPlayerId, localPlayerId) : "-";
  const landlord = snapshot.landlordId ? formatActor(snapshot.landlordId, localPlayerId) : "-";
  const candidate = snapshot.bidCandidateId ? formatActor(snapshot.bidCandidateId, localPlayerId) : "-";
  const offlinePlayers = snapshot.players.filter((player) => !player.connected).map((player) => formatActor(player.id, localPlayerId));
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
  const current = snapshot.currentPlayerId ? formatActor(snapshot.currentPlayerId, localPlayerId) : "-";

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
      return snapshot.settlement ? `本局结束，赢家 ${formatActor(snapshot.settlement.winnerId, localPlayerId)}` : "本局结束";
  }
}

export function describeEventFeedback(event: GameEvent, localPlayerId: string): string | null {
  switch (event.type) {
    case "snapshot":
    case "turn_timer":
    case "player_connection_changed":
      return null;
    case "player_joined":
      return `${formatActor(event.playerId, localPlayerId)} 入座`;
    case "player_ready":
      return `${formatActor(event.playerId, localPlayerId)} 已准备`;
    case "round_started":
      return "新一局开始，发牌";
    case "landlord_bid":
      return `${formatActor(event.playerId, localPlayerId)} ${event.called ? "叫地主" : "不叫"}`;
    case "landlord_robbed":
      return `${formatActor(event.playerId, localPlayerId)} ${event.robbed ? "抢地主" : "不抢"}`;
    case "cards_played":
      return `${formatActor(event.play.playerId, localPlayerId)} 出牌 ${combinationKindLabel(event.play.combination.kind)}`;
    case "player_passed":
      return `${formatActor(event.playerId, localPlayerId)} 过牌`;
    case "round_settled":
      return `本局结算，赢家 ${formatActor(event.settlement.winnerId, localPlayerId)}`;
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

  return [
    `赢家 ${formatActor(snapshot.settlement.winnerId, localPlayerId)}`,
    `地主 ${formatActor(snapshot.settlement.landlordId, localPlayerId)}`,
    ...snapshot.settlement.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((player) => {
        const role = player.role === "landlord" ? "地主" : "农民";
        return `${formatActor(player.playerId, localPlayerId)}  ${role}  ${formatScore(player.scoreDelta)}  总分 ${player.totalScore}`;
      })
  ];
}

export function formatActor(playerId: string, localPlayerId: string): string {
  if (playerId === localPlayerId) {
    return "你";
  }

  if (playerId.startsWith("bot:")) {
    const index = playerId.split(":").at(-1);
    return `机器人${index ?? ""}`;
  }

  return shortId(playerId);
}

function formatScore(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}
