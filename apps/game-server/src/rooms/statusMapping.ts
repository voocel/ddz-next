import type { GameSnapshot } from "@ddz/domain";
import type { RoomStatus } from "@ddz/protocol";

export function mapSnapshotToRoomStatus(snapshot: GameSnapshot): RoomStatus | null {
  if (snapshot.phase === "settled") {
    return "closed";
  }

  if (snapshot.phase === "bidding" || snapshot.phase === "robbing" || snapshot.phase === "playing") {
    return "playing";
  }

  if (snapshot.phase === "ready" && snapshot.players.length === 3) {
    return "playing";
  }

  if (snapshot.players.length < 3 && snapshot.players.every((player) => player.kind === "bot" || !player.connected)) {
    return "open";
  }

  return null;
}
