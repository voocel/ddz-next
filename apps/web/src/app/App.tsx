import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import type { BotModelRefDto } from "@ddz/protocol";
import { REASONING_EFFORTS, type ReasoningEffort } from "../botPreferences";
import { useDdzApp, type DdzApp } from "./useDdzApp";
import { useTurnAlarm } from "./useTurnAlarm";
import { useBackgroundMusic } from "./useBackgroundMusic";
import { AudioSettings } from "./components/AudioSettings";
import { BotSettings } from "./components/BotSettings";
import { Modal } from "./components/Modal";
import { ArenaScreen } from "./screens/ArenaScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { LeaderboardScreen } from "./screens/LeaderboardScreen";
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
      <Routes>
        <Route path="/login" element={app.session ? <Navigate to="/" replace /> : <AuthScreen app={app} />} />
        <Route path="/" element={<LobbyPage app={app} onOpenSettings={openSettings} />} />
        <Route path="/table/:code" element={<TablePage app={app} tableRef={tableRef} onOpenSettings={openSettings} />} />
        <Route path="/arena/:code" element={<ArenaPage app={app} onOpenSettings={openSettings} />} />
        <Route
          path="/replay/:roundId"
          element={<ReplayPage app={app} tableRef={tableRef} onOpenSettings={openSettings} />}
        />
        <Route path="/leaderboard" element={<LeaderboardPage app={app} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

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

interface LobbyPageProps {
  readonly app: DdzApp;
  readonly onOpenSettings: () => void;
}

interface TablePageProps extends LobbyPageProps {
  readonly tableRef: RefObject<PhaserTableHandle | null>;
}

/** 大厅：未登录去 /login；带着房间状态回到大厅（浏览器后退）视同离开房间 */
function LobbyPage({ app, onOpenSettings }: LobbyPageProps) {
  const { session, selectedRoom, leaveRoom } = app;

  useEffect(() => {
    if (session && selectedRoom) {
      leaveRoom();
    }
  }, [leaveRoom, selectedRoom, session]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <LobbyScreen app={app} onOpenSettings={onOpenSettings} />;
}

/** 牌桌：URL 为入口事实源——直连/刷新时按 code 查房进场（在局房间会走服务端重连恢复） */
function TablePage({ app, tableRef, onOpenSettings }: TablePageProps) {
  const { code } = useParams();
  const { session, selectedRoom, enterRoomByCode } = app;

  useEffect(() => {
    if (!session || !code || selectedRoom?.code === code) {
      return;
    }
    void enterRoomByCode(code);
  }, [code, enterRoomByCode, selectedRoom?.code, session]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (!selectedRoom || selectedRoom.code !== code) {
    return <RouteLoading text={`正在进入房间 ${code ?? ""}…`} />;
  }

  return <TableScreen app={app} tableRef={tableRef} onOpenSettings={onOpenSettings} />;
}

/** 回放：直连 /replay/:roundId 时按 roundId 拉取（仅本人战绩），加载失败回大厅 */
function ReplayPage({ app, tableRef, onOpenSettings }: TablePageProps) {
  const { roundId } = useParams();
  const { session, selectedReplay, loadReplay, goHome } = app;

  useEffect(() => {
    if (!session || !roundId || selectedReplay?.id === roundId) {
      return;
    }
    void loadReplay(roundId).then((loaded) => {
      if (!loaded) {
        goHome();
      }
    });
  }, [goHome, loadReplay, roundId, selectedReplay?.id, session]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (!selectedReplay || selectedReplay.id !== roundId) {
    return <RouteLoading text="正在加载回放…" />;
  }

  return <TableScreen app={app} tableRef={tableRef} onOpenSettings={onOpenSettings} />;
}

/** 竞技场观战：key=code 保证切房时观战域整体重建；创建方经路由 state 携带三席阵容 */
function ArenaPage({ app, onOpenSettings }: LobbyPageProps) {
  const { code } = useParams();
  const location = useLocation();

  if (!app.session) {
    return <Navigate to="/login" replace />;
  }
  if (!code) {
    return <Navigate to="/" replace />;
  }

  return (
    <ArenaScreen
      key={code}
      code={code}
      session={app.session}
      lineup={readLineupState(location.state)}
      botReasoningEffort={readEffortState(location.state)}
      theme={app.theme}
      audioLevels={app.audioLevels}
      onOpenSettings={onOpenSettings}
      onExit={app.goHome}
    />
  );
}

/** 校验路由 state 里的阵容（历史记录可被手工构造，不可信任形状） */
function readLineupState(state: unknown): readonly BotModelRefDto[] | null {
  if (!state || typeof state !== "object" || !("lineup" in state) || !Array.isArray(state.lineup)) {
    return null;
  }
  const lineup = state.lineup.filter(
    (seat): seat is BotModelRefDto =>
      Boolean(seat) &&
      typeof seat === "object" &&
      typeof (seat as { provider?: unknown }).provider === "string" &&
      typeof (seat as { model?: unknown }).model === "string"
  );
  return lineup.length === 3 ? lineup : null;
}

/** 校验路由 state 里的思考强度（与阵容同源，仅创建方携带；非法/缺省回 null 由服务端定默认） */
function readEffortState(state: unknown): ReasoningEffort | null {
  if (!state || typeof state !== "object" || !("botReasoningEffort" in state)) {
    return null;
  }
  const value = (state as { botReasoningEffort?: unknown }).botReasoningEffort;
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : null;
}

function LeaderboardPage({ app }: { readonly app: DdzApp }) {
  if (!app.session) {
    return <Navigate to="/login" replace />;
  }

  return <LeaderboardScreen app={app} />;
}

function RouteLoading({ text }: { readonly text: string }) {
  return (
    <main className="route-loading">
      <p>{text}</p>
    </main>
  );
}
