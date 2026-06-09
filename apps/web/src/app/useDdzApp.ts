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
  const [username, setUsername] = useState("alice");
  const [nickname, setNickname] = useState("Alice");
  const [password, setPassword] = useState("secret123");
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
        endpoint: import.meta.env.VITE_API_ENDPOINT ?? "http://localhost:3000"
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
          setEvents((items) => [event, ...items].slice(0, 8));
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

  const enterRoom = useCallback(
    (room: RoomDto): void => {
      setSelectedRoom(room);
      setSnapshot(null);
      setEvents([]);
      clearReplay();
      setRooms((items) => [room, ...items.filter((item) => item.id !== room.id)]);
    },
    [clearReplay]
  );

  const resetAuthenticatedState = useCallback((nextStatus: string): void => {
    setAuthStatus("未登录");
    setStatus(nextStatus);
    setRoomStatus(nextStatus);
    setHistoryStatus(nextStatus);
    setReplayStatus("未选择对局");
    setRooms([]);
    setRoundHistory([]);
    setSelectedReplay(null);
    setReplayStep(0);
    setReplayPlaying(false);
    setCoinLedgers([]);
    setSelectedRoom(null);
    setSnapshot(null);
    setTurnTimer(null);
    setEvents([]);
  }, []);

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
    client.disconnect();
    setSession(null);
    clearStoredSession();
    resetAuthenticatedState("等待登录");
  }, [client, resetAuthenticatedState]);

  const leaveRoom = useCallback((): void => {
    if (!selectedRoom) {
      return;
    }

    client.leaveRoom();
    setSelectedRoom(null);
    setStatus("请选择房间");
    setSnapshot(null);
    setTurnTimer(null);
    setEvents([]);
    clearReplay();
    void refreshRooms();
  }, [clearReplay, client, refreshRooms, selectedRoom]);

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

  const selectRoom = useCallback(
    (room: RoomDto): void => {
      setSelectedRoom(room);
      setSnapshot(null);
      setEvents([]);
      clearReplay();
      setStatus(`准备进入房间 ${room.code}`);
    },
    [clearReplay]
  );

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
      setSnapshot(null);
      setTurnTimer(null);
      setEvents([]);
      return;
    }

    client.connect();
    return () => {
      client.disconnect();
    };
  }, [client, selectedRoom, session]);

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
    selectRoom,
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
