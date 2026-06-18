import { useCallback, useRef, useState } from "react";
import { useDdzApp } from "./useDdzApp";
import { useTurnAlarm } from "./useTurnAlarm";
import { useBackgroundMusic } from "./useBackgroundMusic";
import { AudioSettings } from "./components/AudioSettings";
import { BotSettings } from "./components/BotSettings";
import { Modal } from "./components/Modal";
import { AuthScreen } from "./screens/AuthScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { TableScreen } from "./screens/TableScreen";
import type { PhaserTableHandle } from "../PhaserTable";

export function App() {
  const app = useDdzApp();
  // 设置弹窗（音量）跨大厅/牌桌共用：状态与弹窗外壳收敛在组合根，避免两屏各写一份
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tableRef = useRef<PhaserTableHandle | null>(null);

  // 本地玩家回合快超时时播放闹钟音（音效在 Phaser 场景内，经命令式句柄触发）
  const handleTurnAlarm = useCallback(() => {
    tableRef.current?.alertTimeout();
  }, []);
  useTurnAlarm(app.turnTimer, app.session?.user.id ?? "", handleTurnAlarm);
  // 全局背景音乐：登录后跨大厅/牌桌持续，不随场景启停（音量由音乐滑块控制）
  useBackgroundMusic(app.theme, app.audioLevels.music, Boolean(app.session));

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <>
      {!app.session ? (
        <AuthScreen app={app} />
      ) : !app.selectedRoom && !app.selectedReplay ? (
        <LobbyScreen app={app} onOpenSettings={openSettings} />
      ) : (
        <TableScreen app={app} tableRef={tableRef} onOpenSettings={openSettings} />
      )}

      {settingsOpen && app.session ? (
        <Modal title="设置" onClose={() => setSettingsOpen(false)}>
          <AudioSettings levels={app.audioLevels} onChange={app.setAudioLevels} />
          <BotSettings
            preferences={app.botPreferences}
            models={app.botModels}
            defaultRef={app.botModelDefault}
            onChange={app.setBotPreferences}
          />
        </Modal>
      ) : null}
    </>
  );
}
