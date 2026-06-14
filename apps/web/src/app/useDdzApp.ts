import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CardId } from "@ddz/domain";
import type {
  CoinLedgerItemDto,
  GameEvent,
  GameSnapshotDto,
  LoginResponse,
  RoomDto,
  RoundHistoryItemDto,
  RoundReplayDto
} from "@ddz/protocol";
import { getTableControlsState } from "../game/controlsState";
import { createApiClient } from "../net/apiClient";
import { createGameClient, isRecoverableDropCode } from "../net/gameClient";
import { createMatchmakingClient } from "../net/matchmakingClient";
import { clearStoredSession, readStoredSession, storeSession } from "./sessionStorage";
import { loadTheme, saveTheme, type ThemeId } from "../theme";
import { loadAudioLevels, saveAudioLevels, type AudioLevels } from "../audio";
import type { AuthMode, TurnTimerState } from "./types";
import { useReplayPlayback } from "./useReplayPlayback";
import { useTurnTimerTicker } from "./useTurnTimerTicker";

type AuthStatusTone = "idle" | "loading" | "success" | "error";

const RECONNECT_RETRY_MS = 2_000;
const RECONNECT_DEADLINE_MS = 15_000;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function useDdzApp() {
  const [session, setSession] = useState<LoginResponse | null>(() => readStoredSession());
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [status, setStatus] = useState("等待登录");
  const [authStatus, setAuthStatus] = useState(() => (session ? `已登录 ${session.user.nickname}` : "未登录"));
  const [authStatusTone, setAuthStatusTone] = useState<AuthStatusTone>(() => (session ? "success" : "idle"));
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  // 开发模式预填演示账号（与 API 的 DEMO_USER_ENABLED 演示用户对应），生产构建保持为空
  const [username, setUsername] = useState(import.meta.env.DEV ? "alice" : "");
  const [nickname, setNickname] = useState(import.meta.env.DEV ? "Alice" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "secret123" : "");
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [roomStatus, setRoomStatus] = useState("等待登录");
  const [historyStatus, setHistoryStatus] = useState("等待登录");
  const [replayStatus, setReplayStatus] = useState("未选择对局");
  const [roundHistory, setRoundHistory] = useState<RoundHistoryItemDto[]>([]);
  const [selectedReplay, setSelectedReplay] = useState<RoundReplayDto | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [coinLedgers, setCoinLedgers] = useState<CoinLedgerItemDto[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomDto | null>(null);
  const [selectedRoomQuickStart, setSelectedRoomQuickStart] = useState(false);
  const [snapshot, setSnapshot] = useState<GameSnapshotDto | null>(null);
  const [turnTimer, setTurnTimer] = useState<TurnTimerState | null>(null);
  const [matchQueue, setMatchQueue] = useState<{ waiting: number; position: number } | null>(null);
  const matchClientRef = useRef<ReturnType<typeof createMatchmakingClient> | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [audioLevels, setAudioLevels] = useState<AudioLevels>(() => loadAudioLevels());
  // 断线自动重连：记录触发时间戳，副作用循环按 deadline 重试（游戏服重启恢复牌局的入口）
  const [reconnectRequest, setReconnectRequest] = useState<number | null>(null);

  /** 静默退出匹配队列（取消、进房、登出时复用） */
  const stopMatching = useCallback((): void => {
    matchClientRef.current?.cancel();
    matchClientRef.current = null;
    setMatchQueue(null);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveAudioLevels(audioLevels);
  }, [audioLevels]);

  const api = useMemo(
    () =>
      createApiClient({
        endpoint: import.meta.env.VITE_API_ENDPOINT ?? "http://localhost:3000",
        onUnauthorized: () => {
          // 令牌失效：清会话回登录屏
          setSession(null);
          clearStoredSession();
          setAuthStatus("登录已过期，请重新登录");
          setAuthStatusTone("error");
        }
      }),
    []
  );

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }

    setHistoryStatus("加载战绩中");
    try {
      const [rounds, ledgers] = await Promise.all([
        api.listRoundHistory(session.accessToken),
        api.listCoinLedgers(session.accessToken)
      ]);
      setRoundHistory(rounds.rounds);
      setCoinLedgers(ledgers.ledgers);
      setSelectedReplay((current) => {
        if (!current) {
          return null;
        }
        return rounds.rounds.some((round) => round.id === current.id) ? current : null;
      });
      setHistoryStatus(rounds.rounds.length || ledgers.ledgers.length ? "已更新" : "暂无战绩");
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "加载战绩失败");
    }
  }, [api, session]);

  const loadReplay = useCallback(
    async (roundId: string): Promise<void> => {
      if (!session) {
        return;
      }

      setReplayStatus("加载回放中");
      try {
        const response = await api.getRoundReplay(session.accessToken, roundId);
        setSelectedReplay(response.round);
        setReplayStep(0);
        setReplayPlaying(false);
        setReplayStatus(`${response.round.actions.length} 条事件`);
      } catch (error) {
        setSelectedReplay(null);
        setReplayStatus(error instanceof Error ? error.message : "加载回放失败");
      }
    },
    [api, session]
  );

  const client = useMemo(
    () =>
      createGameClient({
        endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
        playerId: session?.user.id ?? "",
        accessToken: session?.accessToken ?? "",
        roomCode: selectedRoom?.code ?? "",
        quickStart: selectedRoomQuickStart,
        onStatus: setStatus,
        onDropped: (code) => {
          // 被踢/房间故障：重连必败或会互踢，直接回大厅
          if (!isRecoverableDropCode(code)) {
            setSelectedRoom(null);
            setSelectedRoomQuickStart(false);
            setRoomStatus(`房间连接已断开 (${code})，请重新进入`);
            return;
          }
          // 网络抖动或游戏服重启：留在牌桌自动重连，服务端会恢复牌局并补发快照
          setStatus("连接已断开，正在重连…");
          setReconnectRequest(Date.now());
        },
        onEvent: (event) => {
          if ("snapshot" in event) {
            setSnapshot(event.snapshot);
          }
          if (event.type === "turn_timer") {
            setTurnTimer({
              deadlineAt: event.deadlineAt,
              durationMs: event.durationMs,
              playerId: event.playerId,
              remainingMs: Math.max(0, new Date(event.deadlineAt).getTime() - Date.now())
            });
          }
          if (event.type === "round_settled") {
            setTurnTimer(null);
            void refreshHistory();
          }
          setEvents((items) => [event, ...items].slice(0, 16));
        }
      }),
    [refreshHistory, selectedRoom?.code, selectedRoomQuickStart, session?.accessToken, session?.user.id]
  );

  const tableControls = useMemo(
    () => getTableControlsState(snapshot, session?.user.id ?? "", Boolean(selectedRoom)),
    [selectedRoom, session?.user.id, snapshot]
  );

  const clearReplay = useCallback((): void => {
    setSelectedReplay(null);
    setReplayStep(0);
    setReplayPlaying(false);
    setReplayStatus("未选择对局");
  }, []);

  // 房间内游戏状态的统一清理
  const resetRoomState = useCallback((): void => {
    setSnapshot(null);
    setTurnTimer(null);
    setEvents([]);
    setReconnectRequest(null);
  }, []);

  const enterRoom = useCallback(
    (room: RoomDto, options: { readonly quickStart?: boolean } = {}): void => {
      stopMatching();
      setSelectedRoom(room);
      setSelectedRoomQuickStart(options.quickStart === true);
      resetRoomState();
      clearReplay();
      setStatus(`准备进入房间 ${room.code}`);
      setRooms((items) => [room, ...items.filter((item) => item.id !== room.id)]);
    },
    [clearReplay, resetRoomState, stopMatching]
  );

  const resetAuthenticatedState = useCallback(
    (nextStatus: string): void => {
      stopMatching();
      setStatus(nextStatus);
      setRoomStatus(nextStatus);
      setHistoryStatus(nextStatus);
      setRooms([]);
      setRoundHistory([]);
      setCoinLedgers([]);
      setSelectedRoom(null);
      setSelectedRoomQuickStart(false);
      clearReplay();
      resetRoomState();
    },
    [clearReplay, resetRoomState, stopMatching]
  );

  const handlePass = useCallback((): void => {
    client.pass();
  }, [client]);

  const handlePlay = useCallback(
    (cards: readonly CardId[]): void => {
      client.playCards(cards);
    },
    [client]
  );

  const refreshRooms = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }

    setRoomStatus("加载房间中");
    try {
      const response = await api.listRooms();
      setRooms(response.rooms);
      setRoomStatus(response.rooms.length ? `${response.rooms.length} 个开放房间` : "暂无开放房间");
    } catch (error) {
      setRoomStatus(error instanceof Error ? error.message : "加载房间失败");
    }
  }, [api, session]);

  const submitAuth = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setAuthStatus(authMode === "login" ? "正在登录..." : "正在注册...");
      setAuthStatusTone("loading");

      try {
        const response =
          authMode === "login"
            ? await api.login({
                username,
                password
              })
            : await api.register({
                username,
                nickname,
                password
              });
        setSession(response);
        storeSession(response);
        setAuthStatus(`已登录 ${response.user.nickname}`);
        setAuthStatusTone("success");
        setRoomStatus("加载房间中");
      } catch (error) {
        setSession(null);
        clearStoredSession();
        setAuthStatus(error instanceof Error ? error.message : authMode === "login" ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。");
        setAuthStatusTone("error");
      }
    },
    [api, authMode, nickname, password, username]
  );

  const logout = useCallback((): void => {
    // 断线与状态清理由 session/selectedRoom 副作用统一处理
    setSession(null);
    clearStoredSession();
    setAuthStatus("未登录");
    setAuthStatusTone("idle");
  }, []);

  const leaveRoom = useCallback((): void => {
    if (!selectedRoom) {
      return;
    }

    // 置空 selectedRoom 后，连接副作用会负责断开与游戏状态清理
    setSelectedRoom(null);
    setSelectedRoomQuickStart(false);
    clearReplay();
    void refreshRooms();
  }, [clearReplay, refreshRooms, selectedRoom]);

  const createRoom = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }

    setRoomStatus("创建房间中");
    try {
      const response = await api.createRoom(session.accessToken);
      enterRoom(response.room);
      setRoomStatus(`已创建房间 ${response.room.code}`);
    } catch (error) {
      setRoomStatus(error instanceof Error ? error.message : "创建房间失败");
    }
  }, [api, enterRoom, session]);

  const matchRoom = useCallback((): void => {
    if (!session || matchClientRef.current) {
      return;
    }

    setRoomStatus("匹配中");
    setMatchQueue({ waiting: 1, position: 1 });
    const matchClient = createMatchmakingClient({
      endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
      accessToken: session.accessToken,
      onEvent: (event) => {
        if (event.type === "queue_status") {
          setMatchQueue({ waiting: event.waiting, position: event.position });
          return;
        }
        if (event.type === "matched") {
          enterRoom(event.room, {
            quickStart: true
          });
          setRoomStatus(`已匹配到房间 ${event.room.code}`);
          return;
        }
        setRoomStatus(event.message);
      },
      onStatus: setRoomStatus,
      onClosed: () => {
        matchClientRef.current = null;
        setMatchQueue(null);
      }
    });
    matchClientRef.current = matchClient;
    void matchClient.start();
  }, [enterRoom, session]);

  const cancelMatch = useCallback((): void => {
    stopMatching();
    setRoomStatus("已取消匹配");
  }, [stopMatching]);

  useEffect(() => {
    if (!session) {
      resetAuthenticatedState("等待登录");
      return;
    }

    void refreshRooms();
    void refreshHistory();
  }, [refreshHistory, refreshRooms, resetAuthenticatedState, session]);

  useEffect(() => {
    if (!session || !selectedRoom) {
      client.disconnect();
      setStatus(session ? "请选择房间" : "等待登录");
      resetRoomState();
      return;
    }

    void client.connect();
    return () => {
      client.disconnect();
    };
  }, [client, resetRoomState, selectedRoom, session]);

  // 断线自动重连循环：2s 间隔重试至 15s，成功则服务端补发快照无缝恢复，超时回大厅
  useEffect(() => {
    if (reconnectRequest === null || !session || !selectedRoom) {
      return;
    }

    let cancelled = false;
    const deadline = reconnectRequest + RECONNECT_DEADLINE_MS;
    const run = async (): Promise<void> => {
      while (!cancelled && Date.now() < deadline) {
        if (await client.connect()) {
          if (!cancelled) {
            setReconnectRequest(null);
          }
          return;
        }
        await delay(RECONNECT_RETRY_MS);
      }
      if (!cancelled) {
        setReconnectRequest(null);
        setSelectedRoom(null);
        setSelectedRoomQuickStart(false);
        setRoomStatus("重连失败，请重新进入房间");
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [client, reconnectRequest, selectedRoom, session]);

  useReplayPlayback({
    replayPlaying,
    replayStep,
    selectedReplay,
    setReplayPlaying,
    setReplayStep
  });
  useTurnTimerTicker(turnTimer, setTurnTimer);

  return {
    authMode,
    authStatus,
    authStatusTone,
    cancelMatch,
    clearReplay,
    client,
    coinLedgers,
    createRoom,
    enterRoom,
    events,
    handlePass,
    handlePlay,
    historyStatus,
    leaveRoom,
    loadReplay,
    logout,
    matchQueue,
    matchRoom,
    nickname,
    password,
    reconnecting: reconnectRequest !== null,
    refreshHistory,
    refreshRooms,
    replayPlaying,
    replayStatus,
    replayStep,
    roomStatus,
    rooms,
    roundHistory,
    selectedReplay,
    selectedRoom,
    session,
    audioLevels,
    setAudioLevels,
    setAuthMode,
    setNickname,
    setPassword,
    setReplayPlaying,
    setReplayStep,
    setTheme,
    setUsername,
    snapshot,
    status,
    submitAuth,
    tableControls,
    theme,
    turnTimer,
    username
  };
}
