import { useEffect, useState } from "react";
import type { LeaderboardEntryDto, RoundHistoryItemDto } from "@ddz/protocol";
import { modelProfile } from "../../modelProfiles";
import type { DdzApp } from "../useDdzApp";

function pct(part: number, total: number): string {
  return total === 0 ? "-" : `${((part / total) * 100).toFixed(1)}%`;
}

function formatEndedAt(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 模型排行榜：聚合全部已结束对局（网页直播局 + headless 竞赛入库后自动计入），附最近公开对局的复盘入口 */
export function LeaderboardScreen({ app }: { readonly app: DdzApp }) {
  const { fetchLeaderboard, fetchRecentReplays, loadReplay, goHome } = app;
  const [entries, setEntries] = useState<readonly LeaderboardEntryDto[] | null>(null);
  const [recentRounds, setRecentRounds] = useState<readonly RoundHistoryItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard()
      .then((response) => {
        if (!cancelled) {
          setEntries(response.entries);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "加载排行榜失败");
        }
      });
    // 复盘入口是附属板块：失败仅隐藏，不影响榜单展示
    fetchRecentReplays()
      .then((response) => {
        if (!cancelled) {
          setRecentRounds(response.rounds);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchLeaderboard, fetchRecentReplays]);

  return (
    <main className="leaderboard-screen">
      <header className="leaderboard-head">
        <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={goHome}>
          返回大厅
        </button>
        <h1>模型排行榜</h1>
        <span className="leaderboard-hint">按总胜率排序 · 技术负为 AI 决策失败的流局</span>
      </header>

      {error ? <p className="empty-state">{error}</p> : null}
      {!error && entries === null ? <p className="empty-state">加载中…</p> : null}
      {entries?.length === 0 ? <p className="empty-state">暂无对局数据，先去竞技场开一场吧</p> : null}

      {entries?.length ? (
        <ol className="leaderboard-list">
          {entries.map((entry, index) => {
            const profile = modelProfile(entry.model, entry.provider);
            return (
              <li key={`${entry.provider}/${entry.model}`} className="leaderboard-row">
                <span className={`leaderboard-rank${index < 3 ? " is-top" : ""}`}>{index + 1}</span>
                <img className="leaderboard-avatar" src={profile.avatar} alt="" />
                <span className="leaderboard-name">
                  <strong>{profile.alias}</strong>
                  <span>{entry.model}</span>
                </span>
                <span className="leaderboard-stat">
                  <strong>{pct(entry.wins, entry.games)}</strong>
                  <span>{entry.wins}/{entry.games} 胜</span>
                </span>
                <span className="leaderboard-stat">
                  <strong>{pct(entry.landlordWins, entry.landlordGames)}</strong>
                  <span>地主 {entry.landlordWins}/{entry.landlordGames}</span>
                </span>
                <span className="leaderboard-stat">
                  <strong>{pct(entry.farmerWins, entry.farmerGames)}</strong>
                  <span>农民 {entry.farmerWins}/{entry.farmerGames}</span>
                </span>
                <span className="leaderboard-stat">
                  <strong>{entry.totalScore > 0 ? `+${entry.totalScore}` : entry.totalScore}</strong>
                  <span>累计分</span>
                </span>
                {entry.technicalLosses ? (
                  <span className="leaderboard-flaw">技术负 {entry.technicalLosses}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {recentRounds.length ? (
        <section className="recent-replays">
          <h2>最近 AI 对局</h2>
          <ul className="recent-replays-list">
            {recentRounds.map((round) => {
              const landlordWon = round.players.some(
                (player) => player.playerId === round.landlordId && player.score > 0
              );
              return (
                <li key={round.id} className="recent-replay-row">
                  <span className="recent-replay-time">{formatEndedAt(round.endedAt)}</span>
                  <span className="recent-replay-players">
                    {round.players.map((player) => {
                      const profile = modelProfile(player.model?.model ?? "", player.model?.provider ?? "");
                      const isLandlord = player.playerId === round.landlordId;
                      return (
                        <span
                          key={player.playerId}
                          className={`recent-replay-player${isLandlord ? " is-landlord" : ""}`}
                          title={player.nickname ?? profile.alias}
                        >
                          <img src={profile.avatar} alt="" />
                          <span>
                            {isLandlord ? "👑" : ""}
                            {profile.alias}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  <span className="recent-replay-result">{landlordWon ? "地主胜" : "农民胜"}</span>
                  <button
                    type="button"
                    className="btn-img btn-img-wood btn-img-sm"
                    onClick={() => void loadReplay(round.id)}
                  >
                    复盘
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
