import type { GameSnapshot } from "@ddz/domain";
import type { RoomStatus } from "@ddz/protocol";

export function mapSnapshotToRoomStatus(snapshot: GameSnapshot): RoomStatus {
  // settled 仍属于本房间的局内结算态,等待玩家准备下一局;对外保持 playing,避免被匹配新玩家插入。
  if (snapshot.phase === "bidding" || snapshot.phase === "robbing" || snapshot.phase === "playing" || snapshot.phase === "settled") {
    return "playing";
  }

  // waiting/ready：满员则停止匹配，有空位则保持可加入
  return snapshot.players.length === 3 ? "playing" : "open";
}
