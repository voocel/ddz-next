import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardId } from "@ddz/domain";
import type { GameEvent, GameSnapshotDto, RoomDto } from "@ddz/protocol";
import { getTableControlsState } from "../game/controlsState";
import { createGameClient, isRecoverableDropCode } from "../net/gameClient";
import { createMatchmakingClient } from "../net/matchmakingClient";
import { loadTheme, saveTheme, type ThemeId } from "../theme";
import { loadAudioLevels, saveAudioLevels, type AudioLevels } from "../audio";
import type { TurnTimerState } from "./types";
import { useAuthSession } from "./useAuthSession";
import { useHistoryReplay } from "./useHistoryReplay";
import { useTurnTimerTicker } from "./useTurnTimerTicker";

const RECONNECT_RETRY_MS = 2_000;
const RECONNECT_DEADLINE_MS = 15_000;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

/**
 * 应用根 hook：组合账号域（useAuthSession）、战绩回放域（useHistoryReplay）与房间/对局核心，
 * 把少数跨域接线显式化——round_settled 后刷新战绩、进出房间时清回放——并对外暴露扁平状态包。
 */
export function useDdzApp() {
  const { api, ...auth } = useAuthSession();
  const history = useHistoryReplay(api, auth.session);

  const [events, setEvents] = useState<GameEvent[]>([]);
  const [status, setStatus] = useState("等待登录");
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [roomStatus, setRoomStatus] = useState("等待登录");
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

  const client = useMemo(
    () =>
      createGameClient({
        endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
        playerId: auth.session?.user.id ?? "",
        accessToken: auth.session?.accessToken ?? "",
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
            void history.refreshHistory();
          }
          setEvents((items) => [event, ...items].slice(0, 16));
        }
      }),
    [history.refreshHistory, selectedRoom?.code, selectedRoomQuickStart, auth.session?.accessToken, auth.session?.user.id]
  );

  const tableControls = useMemo(
    () => getTableControlsState(snapshot, auth.session?.user.id ?? "", Boolean(selectedRoom)),
    [selectedRoom, auth.session?.user.id, snapshot]
  );

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
      history.clearReplay();
      setStatus(`准备进入房间 ${room.code}`);
      setRooms((items) => [room, ...items.filter((item) => item.id !== room.id)]);
    },
    [history.clearReplay, resetRoomState, stopMatching]
  );

  /** 登出/无会话时清空房间与大厅域状态（战绩回放域由其自身的 session 副作用清理） */
  const resetRoomLobby = useCallback(
    (nextStatus: string): void => {
      stopMatching();
      setStatus(nextStatus);
      setRoomStatus(nextStatus);
      setRooms([]);
      setSelectedRoom(null);
      setSelectedRoomQuickStart(false);
      resetRoomState();
    },
    [resetRoomState, stopMatching]
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
    if (!auth.session) {
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
  }, [api, auth.session]);

  const leaveRoom = useCallback((): void => {
    if (!selectedRoom) {
      return;
    }

    // 置空 selectedRoom 后，连接副作用会负责断开与游戏状态清理
    setSelectedRoom(null);
    setSelectedRoomQuickStart(false);
    history.clearReplay();
    void refreshRooms();
  }, [history.clearReplay, refreshRooms, selectedRoom]);

  const createRoom = useCallback(async (): Promise<void> => {
    if (!auth.session) {
      return;
    }

    setRoomStatus("创建房间中");
    try {
      const response = await api.createRoom(auth.session.accessToken);
      enterRoom(response.room);
      setRoomStatus(`已创建房间 ${response.room.code}`);
    } catch (error) {
      setRoomStatus(error instanceof Error ? error.message : "创建房间失败");
    }
  }, [api, enterRoom, auth.session]);

  const matchRoom = useCallback((): void => {
    if (!auth.session || matchClientRef.current) {
      return;
    }

    setRoomStatus("匹配中");
    setMatchQueue({ waiting: 1, position: 1 });
    const matchClient = createMatchmakingClient({
      endpoint: import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567",
      accessToken: auth.session.accessToken,
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
  }, [enterRoom, auth.session]);

  const cancelMatch = useCallback((): void => {
    stopMatching();
    setRoomStatus("已取消匹配");
  }, [stopMatching]);

  useEffect(() => {
    if (!auth.session) {
      resetRoomLobby("等待登录");
      return;
    }

    void refreshRooms();
  }, [auth.session, refreshRooms, resetRoomLobby]);

  useEffect(() => {
    if (!auth.session || !selectedRoom) {
      client.disconnect();
      setStatus(auth.session ? "请选择房间" : "等待登录");
      resetRoomState();
      return;
    }

    void client.connect();
    return () => {
      client.disconnect();
    };
  }, [client, resetRoomState, selectedRoom, auth.session]);

  // 断线自动重连循环：2s 间隔重试至 15s，成功则服务端补发快照无缝恢复，超时回大厅
  useEffect(() => {
    if (reconnectRequest === null || !auth.session || !selectedRoom) {
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
  }, [client, reconnectRequest, selectedRoom, auth.session]);

  useTurnTimerTicker(turnTimer, setTurnTimer);

  return {
    ...auth,
    ...history,
    audioLevels,
    setAudioLevels,
    theme,
    setTheme,
    cancelMatch,
    client,
    createRoom,
    enterRoom,
    events,
    handlePass,
    handlePlay,
    leaveRoom,
    matchQueue,
    matchRoom,
    reconnecting: reconnectRequest !== null,
    refreshRooms,
    roomStatus,
    rooms,
    selectedRoom,
    snapshot,
    status,
    tableControls,
    turnTimer
  };
}

/** 应用根状态包：useDdzApp 的返回类型，供各屏/控制组件以单一道具接收 */
export type DdzApp = ReturnType<typeof useDdzApp>;
