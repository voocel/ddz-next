import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { createGameClient } from "../net/gameClient";
import { clearStoredSession, readStoredSession, storeSession } from "./sessionStorage";
import type { AuthMode, TurnTimerState } from "./types";
import { useReplayPlayback } from "./useReplayPlayback";
import { useTurnTimerTicker } from "./useTurnTimerTicker";

export function useDdzApp() {
  const [session, setSession] = useState<LoginResponse | null>(() => readStoredSession());
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [status, setStatus] = useState("等待登录");
  const [authStatus, setAuthStatus] = useState(() => (session ? `已登录 ${session.user.nickname}` : "未登录"));
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
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
  const [snapshot, setSnapshot] = useState<GameSnapshotDto | null>(null);
  const [turnTimer, setTurnTimer] = useState<TurnTimerState | null>(null);

  const api = useMemo(
    () =>
      createApiClient({
        endpoint: import.meta.env.VITE_API_ENDPOINT ?? "http://localhost:3000",
        onUnauthorized: () => {
          // 令牌失效：清会话回登录屏
          setSession(null);
          clearStoredSession();
          setAuthStatus("登录已过期，请重新登录");
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
        onStatus: setStatus,
        onDropped: (code) => {
          // 房间异常断开：清理游戏状态回大厅，并在大厅提示
          setSelectedRoom(null);
          setRoomStatus(`房间连接已断开 (${code})，请重新进入`);
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
    [refreshHistory, selectedRoom?.code, session?.accessToken, session?.user.id]
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
  }, []);

  const enterRoom = useCallback(
    (room: RoomDto): void => {
      setSelectedRoom(room);
      resetRoomState();
      clearReplay();
      setStatus(`准备进入房间 ${room.code}`);
      setRooms((items) => [room, ...items.filter((item) => item.id !== room.id)]);
    },
    [clearReplay, resetRoomState]
  );

  const resetAuthenticatedState = useCallback(
    (nextStatus: string): void => {
      setStatus(nextStatus);
      setRoomStatus(nextStatus);
      setHistoryStatus(nextStatus);
      setRooms([]);
      setRoundHistory([]);
      setCoinLedgers([]);
      setSelectedRoom(null);
      clearReplay();
      resetRoomState();
    },
    [clearReplay, resetRoomState]
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
      setAuthStatus("提交中");

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
        setRoomStatus("加载房间中");
      } catch (error) {
        setSession(null);
        clearStoredSession();
        setAuthStatus(error instanceof Error ? error.message : "认证失败");
      }
    },
    [api, authMode, nickname, password, username]
  );

  const logout = useCallback((): void => {
    // 断线与状态清理由 session/selectedRoom 副作用统一处理
    setSession(null);
    clearStoredSession();
    setAuthStatus("未登录");
  }, []);

  const leaveRoom = useCallback((): void => {
    if (!selectedRoom) {
      return;
    }

    // 置空 selectedRoom 后，连接副作用会负责断开与游戏状态清理
    setSelectedRoom(null);
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

  const matchRoom = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }

    setRoomStatus("匹配房间中");
    try {
      const response = await api.matchRoom(session.accessToken);
      enterRoom(response.room);
      setRoomStatus(`已匹配房间 ${response.room.code}`);
    } catch (error) {
      setRoomStatus(error instanceof Error ? error.message : "匹配房间失败");
    }
  }, [api, enterRoom, session]);

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
    matchRoom,
    nickname,
    password,
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
    setAuthMode,
    setNickname,
    setPassword,
    setReplayPlaying,
    setReplayStep,
    setUsername,
    snapshot,
    status,
    submitAuth,
    tableControls,
    turnTimer,
    username
  };
}
