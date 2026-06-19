import type { GameSnapshotDto } from "@ddz/protocol";

export interface TableControlsState {
  readonly ready: boolean;
  readonly bid: boolean;
  readonly rob: boolean;
  readonly pass: boolean;
  readonly leave: boolean;
}

export function getTableControlsState(
  snapshot: GameSnapshotDto | null,
  localPlayerId: string,
  inRoom: boolean
): TableControlsState {
  if (!inRoom) {
    return {
      ready: false,
      bid: false,
      rob: false,
      pass: false,
      leave: false
    };
  }

  const localPlayer = snapshot?.players.find((player) => player.id === localPlayerId);
  const localTurn = Boolean(snapshot && snapshot.currentPlayerId === localPlayerId);

  return {
    // 本地玩家未入座时不允许准备；settled 阶段的“准备”表示确认进入下一局。
    ready: Boolean(
      snapshot &&
        localPlayer &&
        (snapshot.phase === "settled" ||
          ((snapshot.phase === "waiting" || snapshot.phase === "ready") && !localPlayer.ready))
    ),
    bid: Boolean(snapshot?.phase === "bidding" && localTurn),
    rob: Boolean(snapshot?.phase === "robbing" && localTurn),
    pass: Boolean(snapshot?.phase === "playing" && localTurn),
    leave: true
  };
}
