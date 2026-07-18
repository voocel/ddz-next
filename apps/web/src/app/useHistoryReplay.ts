import { useCallback, useEffect, useState } from "react";
import type { CoinLedgerItemDto, LoginResponse, RoundHistoryItemDto, RoundReplayDto } from "@ddz/protocol";
import type { createApiClient } from "../net/apiClient";
import { useReplayPlayback } from "./useReplayPlayback";

type ApiClient = ReturnType<typeof createApiClient>;

/**
 * 战绩与回放域：个人战绩列表、金币流水、单局回放的加载与步进播放。
 * 仅依赖 api + session：session 置空时自清空；round_settled 后由房间域调用 refreshHistory 刷新。
 */
export function useHistoryReplay(api: ApiClient, session: LoginResponse | null) {
  const [roundHistory, setRoundHistory] = useState<RoundHistoryItemDto[]>([]);
  const [coinLedgers, setCoinLedgers] = useState<CoinLedgerItemDto[]>([]);
  const [historyStatus, setHistoryStatus] = useState("等待登录");
  const [replayStatus, setReplayStatus] = useState("未选择对局");
  const [selectedReplay, setSelectedReplay] = useState<RoundReplayDto | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const clearReplay = useCallback((): void => {
    setSelectedReplay(null);
    setReplayStep(0);
    setReplayPlaying(false);
    setReplayStatus("未选择对局");
  }, []);

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
        // 公开明牌复盘（revealedHands 非空）不属于个人战绩列表，刷新时保留
        if (current.revealedHands.length > 0) {
          return current;
        }
        return rounds.rounds.some((round) => round.id === current.id) ? current : null;
      });
      setHistoryStatus(rounds.rounds.length || ledgers.ledgers.length ? "已更新" : "暂无战绩");
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
        setReplayStep(0);
        setReplayPlaying(false);
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
      setCoinLedgers([]);
      setHistoryStatus("等待登录");
      clearReplay();
      return;
    }

    void refreshHistory();
  }, [session, refreshHistory, clearReplay]);

  useReplayPlayback({
    replayPlaying,
    replayStep,
    selectedReplay,
    setReplayPlaying,
    setReplayStep
  });

  return {
    roundHistory,
    coinLedgers,
    historyStatus,
    replayStatus,
    selectedReplay,
    replayStep,
    replayPlaying,
    refreshHistory,
    loadReplay,
    clearReplay,
    setReplayStep,
    setReplayPlaying
  };
}
