import type Phaser from "phaser";
import { getTableDevicePixelRatio } from "./tableConfig";

export const TABLE_TEXT_STYLE = {
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontSize: "16px",
  fontStyle: "700",
  color: "#fff6e0",
  resolution: getTableDevicePixelRatio()
} satisfies Phaser.Types.GameObjects.Text.TextStyle;

export const TABLE_INK = "#5b3a1e";
export const TABLE_INK_SOFT = "#7a5a36";

// 按相对本地玩家的座位渲染：0 = 自己（左下角），1 = 下家（右上），2 = 上家（左上）
export const RELATIVE_SEAT_POSITIONS = [
  { x: 130, y: 648 },
  { x: 1064, y: 300 },
  { x: 216, y: 300 }
] as const;

// 出牌展示区回到上半部居中，把下半部让给 HTML 操作控制行。
export const LAST_PLAY_Y = 330;

// 手牌横排贴底；选中的牌上抬 20px。
export const HAND_RESTING_Y = 632;
export const HAND_SELECTED_Y = 612;

export interface StagePoint {
  readonly x: number;
  readonly y: number;
}

export function seatPositionFor(seat: number, localSeat: number | null): StagePoint {
  const relative = localSeat === null ? seat : (seat - localSeat + 3) % 3;
  return RELATIVE_SEAT_POSITIONS[relative] ?? RELATIVE_SEAT_POSITIONS[0];
}
