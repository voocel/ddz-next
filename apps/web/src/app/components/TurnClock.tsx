import { themeAsset, type ThemeId } from "../../theme";

/** 牌桌闹钟：嵌在控制行中间，秒数叠在主题闹钟素材上；≤5 秒变红，本地玩家回合时摇铃 */
export function TurnClock({ theme, remainingMs, local }: { theme: ThemeId; remainingMs: number; local: boolean }) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const low = seconds <= 5;
  return (
    <span className={`turn-clock${low ? " is-low" : ""}${low && local ? " is-wobble" : ""}`}>
      <img src={themeAsset(theme, "clock_alarm.png")} alt="" />
      <span className="turn-clock-num">{seconds}</span>
    </span>
  );
}
