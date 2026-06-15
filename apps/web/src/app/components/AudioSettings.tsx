import type { CSSProperties } from "react";
import type { AudioLevels } from "../../audio";

/** 设置弹窗内的一条音量滑块：图标 + 名称 + 0~100% 滑块 + 百分比（0 显示「关」，消除拖到底的歧义） */
function VolumeRow({
  icon,
  mutedIcon = "🔇",
  label,
  value,
  onChange
}: {
  icon: string;
  mutedIcon?: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const percent = Math.round(value * 100);
  const muted = percent <= 0;
  return (
    <label className="volume-row">
      <span className="volume-icon" aria-hidden>
        {muted ? mutedIcon : icon}
      </span>
      <span className="volume-name">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        aria-label={label}
        style={{ "--fill": `${percent}%` } as CSSProperties}
      />
      <span className={`volume-value${muted ? " is-muted" : ""}`}>{muted ? "关" : `${percent}%`}</span>
    </label>
  );
}

/** 音量设置面板：音乐/音效各一条滑块（0~100%，0 即静音），偏好持久化到 localStorage */
export function AudioSettings({ levels, onChange }: { levels: AudioLevels; onChange: (next: AudioLevels) => void }) {
  return (
    <div className="audio-settings">
      <VolumeRow
        icon="🎵"
        label="背景音乐"
        value={levels.music}
        onChange={(music) => onChange({ ...levels, music })}
      />
      <VolumeRow
        icon="🔊"
        label="游戏音效"
        value={levels.sfx}
        onChange={(sfx) => onChange({ ...levels, sfx })}
      />
    </div>
  );
}
