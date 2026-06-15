import { randomInt } from "node:crypto";
import { ROOM_CODE_REGEX } from "@ddz/protocol";

/** 房间号生成：6 位数字（000000–999999，含前导零），加密安全随机避免可预测。 */
export function createRoomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * 规范化外部输入的房间号：去首尾空白后按统一格式校验。
 * 合法返回规范值，非法返回 null（由调用方包装为各自的领域错误，避免在此耦合错误类型）。
 */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim();
  return ROOM_CODE_REGEX.test(code) ? code : null;
}
