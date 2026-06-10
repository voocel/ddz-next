import type { GameSnapshot } from "@ddz/domain";
import type { RoomStatus } from "@ddz/protocol";

export function mapSnapshotToRoomStatus(snapshot: GameSnapshot): RoomStatus {
  // settled 后房间会立即重开下一局，对外仍视为 playing；关闭由 onDispose/failRoom 收尾
  if (snapshot.phase === "bidding" || snapshot.phase === "robbing" || snapshot.phase === "playing" || snapshot.phase === "settled") {
    return "playing";
  }

  // waiting/ready：满员则停止匹配，有空位则保持可加入
  return snapshot.players.length === 3 ? "playing" : "open";
}
