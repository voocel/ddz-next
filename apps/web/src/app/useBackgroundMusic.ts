import { useEffect, useRef } from "react";

import { BGM_VOLUME, bgmKey, SOUND_FILES } from "../game/sounds";
import type { ThemeId } from "../theme";

/**
 * App 级背景音乐：单个循环 <audio>，跨登录/大厅/牌桌持续，不随 Phaser 场景启停。
 * 按主题选曲、按 music 音量调节；受浏览器自动播放限制时，首次用户手势后补播。
 */
export function useBackgroundMusic(theme: ThemeId, musicLevel: number, enabled: boolean): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    audioRef.current = el;
    return () => {
      el.pause();
      audioRef.current = null;
    };
  }, []);

  // 按主题切换曲目（仅在变化时换 src，避免无谓重载）
  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    const url = `/assets/audio/${SOUND_FILES[bgmKey(theme)]}`;
    if (!el.src.endsWith(url)) {
      el.src = url;
    }
  }, [theme]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = Math.min(1, Math.max(0, BGM_VOLUME * musicLevel));
    }
  }, [musicLevel]);

  // 播放/暂停 + 自动播放解锁（被拦截时挂一次性手势监听补播）
  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    if (!enabled || musicLevel <= 0) {
      el.pause();
      return;
    }
    const play = (): void => {
      void el.play().catch(() => {
        // 被自动播放策略拦截，等首次用户手势再播
      });
    };
    play();
    window.addEventListener("pointerdown", play, { once: true });
    return () => window.removeEventListener("pointerdown", play);
  }, [enabled, musicLevel, theme]);
}
