import type { RoomStatus } from "@ddz/protocol";
import { RoomError } from "./errors.js";

// 房间状态合法转移表：closed 为终态。同状态更新允许，用于心跳刷新 updatedAt。
const ROOM_STATUS_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  open: ["playing", "closed"],
  playing: ["open", "closed"],
  closed: []
};

export function assertRoomStatusTransition(current: RoomStatus, next: RoomStatus): void {
  if (current !== next && !ROOM_STATUS_TRANSITIONS[current].includes(next)) {
    throw new RoomError(`Cannot change room status from ${current} to ${next}.`, 409);
  }
}
