import { useEffect, useState } from "react";
import { loadTheme, saveTheme, type ThemeId } from "../theme";
import { loadAudioLevels, saveAudioLevels, type AudioLevels } from "../audio";

/** 外观与声音偏好:主题(写入 documentElement dataset)与音量,均持久化 localStorage;与登录无关。 */
export function usePreferences() {
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [audioLevels, setAudioLevels] = useState<AudioLevels>(() => loadAudioLevels());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveAudioLevels(audioLevels);
  }, [audioLevels]);

  return { theme, setTheme, audioLevels, setAudioLevels };
}
