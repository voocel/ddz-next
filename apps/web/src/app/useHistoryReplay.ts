import { useCallback, useEffect, useState } from "react";
import type { LoginResponse, RoundHistoryItemDto, RoundReplayDto } from "@ddz/protocol";
import type { createApiClient } from "../net/apiClient";

type ApiClient = ReturnType<typeof createApiClient>;

/**
 * 战绩与回放域：个人战绩列表、单局回放数据的加载。
 * 仅依赖 api + session：session 置空时自清空；round_settled 后由房间域调用 refreshHistory 刷新。
 * 步进/播放属展示状态,归 ReplayScreen 自持。
 */
export function useHistoryReplay(api: ApiClient, session: LoginResponse | null) {
  const [roundHistory, setRoundHistory] = useState<RoundHistoryItemDto[]>([]);
  const [historyStatus, setHistoryStatus] = useState("等待登录");
  const [replayStatus, setReplayStatus] = useState("未选择对局");
  const [selectedReplay, setSelectedReplay] = useState<RoundReplayDto | null>(null);

  const clearReplay = useCallback((): void => {
    setSelectedReplay(null);
    setReplayStatus("未选择对局");
  }, []);

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }

    setHistoryStatus("加载战绩中");
    try {
      const rounds = await api.listRoundHistory(session.accessToken);
      setRoundHistory(rounds.rounds);
      setSelectedReplay((current) => {
        if (!current) {
          return null;
        }
        // 公开明牌复盘（revealedHands 非空）不属于个人战绩列表，刷新时保留
        if (current.revealedHands.length > 0) {
          return current;
        }
        return rounds.rounds.some((round) => round.id === current.id) ? current : null;
      });
      setHistoryStatus(rounds.rounds.length ? "已更新" : "暂无战绩");
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "加载战绩失败");
    }
  }, [api, session]);

  const loadReplay = useCallback(
    async (roundId: string): Promise<boolean> => {
      setReplayStatus("加载回放中");
      try {
        // 本人战绩优先（真人局私有通道）；非本人的局回退公开通道（仅全 bot 局，明牌）
        const response = session
          ? await api.getRoundReplay(session.accessToken, roundId).catch(() => api.getPublicRoundReplay(roundId))
          : await api.getPublicRoundReplay(roundId);
        setSelectedReplay(response.round);
        setReplayStatus(`${response.round.actions.length} 条事件`);
        return true;
      } catch (error) {
        setSelectedReplay(null);
        setReplayStatus(error instanceof Error ? error.message : "加载回放失败");
        return false;
      }
    },
    [api, session]
  );

  // 登录后拉取战绩；登出（session 置空）时清空本域状态
  useEffect(() => {
    if (!session) {
      setRoundHistory([]);
      setHistoryStatus("等待登录");
      clearReplay();
      return;
    }

    void refreshHistory();
  }, [session, refreshHistory, clearReplay]);

  return {
    roundHistory,
    historyStatus,
    replayStatus,
    selectedReplay,
    refreshHistory,
    loadReplay,
    clearReplay
  };
}
