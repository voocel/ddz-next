import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import type { BotModelRefDto, LoginResponse, RoundReplayDto } from "@ddz/protocol";
import type { AudioLevels } from "../audio";
import { nextTheme, type ThemeId } from "../theme";
import { REASONING_EFFORTS, type ReasoningEffort } from "../lineupDefaults";
import type { ApiClient } from "../net/apiClient";
import { useAuthSession } from "./useAuthSession";
import { useHistoryReplay } from "./useHistoryReplay";
import { usePreferences } from "./usePreferences";
import { useBotModels } from "./useBotModels";
import { useRoomSession } from "./useRoomSession";
import { useTurnAlarm } from "./useTurnAlarm";
import { useBackgroundMusic } from "./useBackgroundMusic";
import { AudioSettings } from "./components/AudioSettings";
import { Modal } from "./components/Modal";
import { ArenaScreen } from "./screens/ArenaScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ReplayScreen } from "./screens/ReplayScreen";
import { TableScreen } from "./screens/TableScreen";
import type { PhaserTableHandle } from "../PhaserTable";

/**
 * 组合根：账号（useAuthSession）、战绩回放（useHistoryReplay）、偏好（usePreferences）三域在此组合，
 * 各屏以显式 props 接收所需切片。房间对局域随路由页自持（挂载即入房，离开即离房）。
 */
export function App() {
  const { api, ...auth } = useAuthSession();
  const history = useHistoryReplay(api, auth.session);
  const prefs = usePreferences();
  const botModels = useBotModels();
  // 设置弹窗（音量）跨屏共用：状态与弹窗外壳收敛在组合根，避免各屏各写一份
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 全局背景音乐：跨首页/牌桌持续，不随场景启停，不以登录为门（音量由音乐滑块控制）
  useBackgroundMusic(prefs.theme, prefs.audioLevels.music, true);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const cycleTheme = useCallback(() => {
    prefs.setTheme((current) => nextTheme(current));
  }, [prefs.setTheme]);
  const refreshHistory = useCallback(() => {
    void history.refreshHistory();
  }, [history.refreshHistory]);

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={auth.session ? <Navigate to="/" replace /> : <AuthScreen auth={auth} theme={prefs.theme} />}
        />
        <Route
          path="/"
          element={
            <HomeScreen
              session={auth.session}
              api={api}
              theme={prefs.theme}
              onCycleTheme={cycleTheme}
              botModels={botModels}
              roundHistory={history.roundHistory}
              historyStatus={history.historyStatus}
              refreshHistory={refreshHistory}
              onOpenSettings={openSettings}
              onLogout={auth.logout}
            />
          }
        />
        <Route
          path="/table/:code"
          element={
            <TablePage
              session={auth.session}
              api={api}
              theme={prefs.theme}
              audioLevels={prefs.audioLevels}
              onRoundSettled={refreshHistory}
              onOpenSettings={openSettings}
            />
          }
        />
        <Route
          path="/arena/:code"
          element={
            <ArenaPage
              session={auth.session}
              theme={prefs.theme}
              audioLevels={prefs.audioLevels}
              onOpenSettings={openSettings}
            />
          }
        />
        <Route
          path="/replay/:roundId"
          element={
            <ReplayPage
              session={auth.session}
              selectedReplay={history.selectedReplay}
              loadReplay={history.loadReplay}
              clearReplay={history.clearReplay}
              theme={prefs.theme}
              audioLevels={prefs.audioLevels}
              onOpenSettings={openSettings}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {settingsOpen ? (
        <Modal title="设置" onClose={() => setSettingsOpen(false)}>
          <AudioSettings levels={prefs.audioLevels} onChange={prefs.setAudioLevels} />
        </Modal>
      ) : null}
    </>
  );
}

interface TablePageProps {
  readonly session: LoginResponse | null;
  readonly api: ApiClient;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly onRoundSettled: () => void;
  readonly onOpenSettings: () => void;
}

/** 牌桌：URL 为入口事实源。先按 code 预检房间（closed/不存在回首页），再挂载 TableSession（key=code 切房整体重建） */
function TablePage({ session, api, theme, audioLevels, onRoundSettled, onOpenSettings }: TablePageProps) {
  const { code } = useParams();

  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (!code) {
    return <Navigate to="/" replace />;
  }

  return (
    <TableGate
      key={code}
      code={code}
      session={session}
      api={api}
      theme={theme}
      audioLevels={audioLevels}
      onRoundSettled={onRoundSettled}
      onOpenSettings={onOpenSettings}
    />
  );
}

interface TableSessionProps {
  readonly code: string;
  readonly session: LoginResponse;
  readonly api: ApiClient;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly onRoundSettled: () => void;
  readonly onOpenSettings: () => void;
}

/** 预检闸门：确认房间存在且未结束才连接（在局房间会走服务端重连恢复） */
function TableGate({ code, api, ...rest }: TableSessionProps) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getRoomByCode(code)
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.room.status === "closed") {
          throw new Error(`房间 ${code} 已结束`);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          void navigate("/", { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, code, navigate]);

  if (!ready) {
    return <RouteLoading text={`正在进入房间 ${code}…`} />;
  }

  return <TableSession code={code} api={api} {...rest} />;
}

/**
 * 牌桌会话：挂载即入房、卸载即离房（浏览器后退/切路由天然等于离开房间，
 * 服务端空房 autoDispose 随之释放 AI 对战名额）；建桌阵容经路由 state 携带。
 */
function TableSession({ code, session, theme, audioLevels, onRoundSettled, onOpenSettings }: TableSessionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useMemo(() => {
    const lineup = readLineupState(location.state, 2);
    return lineup ? { lineup, reasoningEffort: readEffortState(location.state) ?? ("medium" as const) } : null;
  }, [location.state]);

  const room = useRoomSession({
    code,
    session,
    create,
    onRoundSettled,
    onEnded: () => void navigate("/", { replace: true })
  });

  // 本地玩家回合快超时时播放闹钟音（音效在 Phaser 场景内，经命令式句柄触发）
  const tableRef = useRef<PhaserTableHandle | null>(null);
  const handleTurnAlarm = useCallback(() => {
    tableRef.current?.alertTimeout();
  }, []);
  useTurnAlarm(room.turnTimer, session.user.id, handleTurnAlarm);

  const leave = useCallback(() => {
    void navigate("/");
  }, [navigate]);

  return (
    <TableScreen
      room={room}
      localPlayerId={session.user.id}
      theme={theme}
      audioLevels={audioLevels}
      tableRef={tableRef}
      onLeave={leave}
      onOpenSettings={onOpenSettings}
    />
  );
}

interface ReplayPageProps {
  readonly session: LoginResponse | null;
  readonly selectedReplay: RoundReplayDto | null;
  readonly loadReplay: (roundId: string) => Promise<boolean>;
  readonly clearReplay: () => void;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly onOpenSettings: () => void;
}

/** 回放（匿名可看）：直连 /replay/:roundId 按 roundId 拉取（登录战绩优先，匿名走公开明牌通道），加载失败回首页 */
function ReplayPage({ session, selectedReplay, loadReplay, clearReplay, theme, audioLevels, onOpenSettings }: ReplayPageProps) {
  const { roundId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!roundId || selectedReplay?.id === roundId) {
      return;
    }
    void loadReplay(roundId).then((loaded) => {
      if (!loaded) {
        void navigate("/", { replace: true });
      }
    });
  }, [loadReplay, navigate, roundId, selectedReplay?.id]);

  if (!selectedReplay || selectedReplay.id !== roundId) {
    return <RouteLoading text="正在加载回放…" />;
  }

  return (
    <ReplayScreen
      key={selectedReplay.id}
      replay={selectedReplay}
      localPlayerId={session?.user.id ?? ""}
      theme={theme}
      audioLevels={audioLevels}
      exitLabel="返回首页"
      onExit={() => {
        clearReplay();
        void navigate("/");
      }}
      onOpenSettings={onOpenSettings}
    />
  );
}

interface ArenaPageProps {
  readonly session: LoginResponse | null;
  readonly theme: ThemeId;
  readonly audioLevels: AudioLevels;
  readonly onOpenSettings: () => void;
}

/** 竞技场观战：key=code 保证切房时观战域整体重建；创建方经路由 state 携带三席阵容 */
function ArenaPage({ session, theme, audioLevels, onOpenSettings }: ArenaPageProps) {
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const lineup = useMemo(() => readLineupState(location.state, 3), [location.state]);
  const botReasoningEffort = useMemo(() => readEffortState(location.state), [location.state]);
  const exit = useCallback(() => {
    void navigate("/");
  }, [navigate]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (!code) {
    return <Navigate to="/" replace />;
  }

  return (
    <ArenaScreen
      key={code}
      code={code}
      session={session}
      lineup={lineup}
      botReasoningEffort={botReasoningEffort}
      theme={theme}
      audioLevels={audioLevels}
      onOpenSettings={onOpenSettings}
      onExit={exit}
    />
  );
}

/** 校验路由 state 里的阵容（历史记录可被手工构造，不可信任形状）；席位数不符即弃用 */
function readLineupState(state: unknown, seats: 2 | 3): readonly BotModelRefDto[] | null {
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
  return lineup.length === seats ? lineup : null;
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

function RouteLoading({ text }: { readonly text: string }) {
  return (
    <main className="route-loading">
      <p>{text}</p>
    </main>
  );
}
