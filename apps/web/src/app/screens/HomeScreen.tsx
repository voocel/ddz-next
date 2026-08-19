import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  BotModelOption,
  BotModelRefDto,
  LeaderboardEntryDto,
  LoginResponse,
  RoomDto,
  RoundHistoryItemDto
} from "@ddz/protocol";
import type { ApiClient } from "../../net/apiClient";
import { avatarAsset, themeAsset, themeLabel, type ThemeId } from "../../theme";
import { modelProfile } from "../../modelProfiles";
import {
  DEFAULT_REASONING_EFFORT,
  LINEUP_SEATS,
  loadLineupDefault,
  saveLineupDefault,
  type LineupKind,
  type ReasoningEffort
} from "../../lineupDefaults";
import { formatDateTime, formatRoundDelta } from "../formatters";
import { defaultLineupPicks, lineupFromPicks, LineupPicker } from "../components/LineupPicker";
import { Modal } from "../components/Modal";
import { useArenaDirectory } from "../useArenaDirectory";

interface HomeScreenProps {
  readonly session: LoginResponse | null;
  readonly api: ApiClient;
  readonly theme: ThemeId;
  readonly onCycleTheme: () => void;
  readonly botModels: readonly BotModelOption[];
  /** 个人战绩（登录后非空语义）；匿名时列表为空即可 */
  readonly roundHistory: readonly RoundHistoryItemDto[];
  readonly historyStatus: string;
  readonly refreshHistory: () => void;
  readonly onOpenSettings: () => void;
  readonly onLogout: () => void;
}

type InfoPanel = "leaderboard" | "live" | "replays" | "mygames";

const INFO_TITLES: Record<InfoPanel, string> = {
  leaderboard: "模型排行榜",
  live: "正在直播",
  replays: "对局回放",
  mygames: "我的战绩"
};

/**
 * AI 首页（匿名可浏览）：游戏大厅——中央主入口（logo/标语/开赛按钮 + 两侧吉祥物），
 * 排行榜/直播/回放/战绩收进右侧图标入口，点击弹窗查看。
 */
export function HomeScreen({
  session,
  api,
  theme,
  onCycleTheme,
  botModels,
  roundHistory,
  historyStatus,
  refreshHistory,
  onOpenSettings,
  onLogout
}: HomeScreenProps) {
  const navigate = useNavigate();
  const arena = useArenaDirectory(api);
  const [modal, setModal] = useState<LineupKind | null>(null);
  const [info, setInfo] = useState<InfoPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const openPicker = (kind: LineupKind): void => {
    if (!session) {
      void navigate("/login");
      return;
    }
    setActionStatus(null);
    setModal(kind);
  };

  const openInfo = (panel: InfoPanel): void => {
    if (panel === "live") {
      void arena.refresh();
    }
    if (panel === "mygames") {
      refreshHistory();
    }
    setInfo(panel);
  };

  const start = async (kind: LineupKind, lineup: readonly BotModelRefDto[], effort: ReasoningEffort): Promise<void> => {
    if (!session) {
      return;
    }
    setBusy(true);
    setActionStatus(kind === "arena" ? "正在创建竞技场…" : "正在开桌…");
    try {
      saveLineupDefault(kind, { models: lineup, reasoningEffort: effort });
      const response = await api.createRoom(session.accessToken, kind === "arena" ? "arena" : "standard");
      void navigate(kind === "arena" ? `/arena/${response.room.code}` : `/table/${response.room.code}`, {
        state: { lineup, botReasoningEffort: effort }
      });
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "创建失败，请稍后重试");
      setBusy(false);
    }
  };

  return (
    <main className="home-screen">
      <header className="home-head">
        {session ? (
          <div className="player-plate home-plate">
            <img src={avatarAsset(theme, session.user.id)} alt="" />
            <div>
              <strong>{session.user.nickname}</strong>
              <span>{session.user.username}</span>
            </div>
          </div>
        ) : null}
        <span className="hud-spacer" />
        <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onCycleTheme}>
          {themeLabel(theme)}
        </button>
        <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onOpenSettings}>
          设置
        </button>
        {session ? (
          <button type="button" className="btn-img btn-img-wood btn-img-sm" onClick={onLogout}>
            退出
          </button>
        ) : (
          <button
            type="button"
            className="btn-img btn-img-orange btn-img-sm"
            onClick={() => void navigate("/login")}
          >
            登录
          </button>
        )}
      </header>

      <section className="home-center">
        <img className="stage-mascot mascot-left" src={themeAsset(theme, "mascot_left.png")} alt="" />
        <img className="stage-mascot mascot-right" src={themeAsset(theme, "mascot_right.png")} alt="" />
        <div className="home-hero-core">
          <img className="home-hero-logo" src="/assets/images/hall_logo_hd.png" alt="斗地主" />
          <p className="home-hero-tagline">大模型打斗地主的公开实验场</p>
          <div className="home-hero-actions">
            <button type="button" className="hero-btn" onClick={() => openPicker("arena")}>
              <img src={themeAsset(theme, "btn_hero_arena.png")} alt="开一场 AI 对战" />
            </button>
            <button type="button" className="hero-btn" onClick={() => openPicker("challenge")}>
              <img src={themeAsset(theme, "btn_hero_challenge.png")} alt="挑战 AI" />
            </button>
          </div>
          {actionStatus && modal === null ? <p className="home-status">{actionStatus}</p> : null}
        </div>
      </section>

      <nav className="home-dock" aria-label="大厅功能">
        <button type="button" className="dock-btn" onClick={() => openInfo("leaderboard")}>
          <span className="dock-icon">
            <img src={themeAsset(theme, "icon_history.png")} alt="" />
          </span>
          <span className="dock-label">排行榜</span>
        </button>
        <button type="button" className="dock-btn" onClick={() => openInfo("live")}>
          <span className="dock-icon">
            <img src={themeAsset(theme, "icon_live.png")} alt="" />
            {arena.rooms.length ? <em className="dock-badge">{arena.rooms.length}</em> : null}
          </span>
          <span className="dock-label">正在直播</span>
        </button>
        <button type="button" className="dock-btn" onClick={() => openInfo("replays")}>
          <span className="dock-icon">
            <img src={themeAsset(theme, "icon_replay.png")} alt="" />
          </span>
          <span className="dock-label">对局回放</span>
        </button>
        {session ? (
          <button type="button" className="dock-btn" onClick={() => openInfo("mygames")}>
            <span className="dock-icon">
              <img src={themeAsset(theme, "icon_medal.png")} alt="" />
            </span>
            <span className="dock-label">我的战绩</span>
          </button>
        ) : null}
      </nav>

      {info ? (
        <Modal title={INFO_TITLES[info]} onClose={() => setInfo(null)}>
          {info === "leaderboard" ? <LeaderboardPanel api={api} /> : null}
          {info === "live" ? <LiveRoomsPanel rooms={arena.rooms} /> : null}
          {info === "replays" ? <RecentReplaysPanel api={api} /> : null}
          {info === "mygames" && session ? (
            roundHistory.length ? (
              <div className="round-history">
                {roundHistory.map((round) => (
                  <button
                    key={round.id}
                    type="button"
                    className="history-row"
                    onClick={() => void navigate(`/replay/${round.id}`)}
                  >
                    <div>
                      <strong>{round.roomCode}</strong>
                      <span>{round.endedAt ? formatDateTime(round.endedAt) : "进行中"}</span>
                    </div>
                    <em>{formatRoundDelta(round, session.user.id)}</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">{historyStatus}</p>
            )
          ) : null}
        </Modal>
      ) : null}

      {modal ? (
        <LineupModal
          kind={modal}
          botModels={botModels}
          busy={busy}
          status={actionStatus}
          onClose={() => {
            setModal(null);
            setActionStatus(null);
          }}
          onSubmit={(lineup, effort) => {
            void start(modal, lineup, effort);
          }}
        />
      ) : null}
    </main>
  );
}

/** 阵容选择弹窗：初始值取上次记住的阵容（模型仍在清单内才复用），确认即建房。 */
function LineupModal({
  kind,
  botModels,
  busy,
  status,
  onClose,
  onSubmit
}: {
  readonly kind: LineupKind;
  readonly botModels: readonly BotModelOption[];
  readonly busy: boolean;
  readonly status: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (lineup: readonly BotModelRefDto[], effort: ReasoningEffort) => void;
}) {
  const seats = LINEUP_SEATS[kind] as 2 | 3;
  const [picks, setPicks] = useState<readonly number[]>(() => {
    const saved = loadLineupDefault(kind);
    return picksFromModels(saved?.models, botModels) ?? defaultLineupPicks(seats, botModels.length);
  });
  const [effort, setEffort] = useState<ReasoningEffort>(
    () => loadLineupDefault(kind)?.reasoningEffort ?? DEFAULT_REASONING_EFFORT
  );

  return (
    <Modal title={kind === "arena" ? "开一场 AI 对战" : "挑战 AI"} onClose={onClose}>
      <div className="section-heading">
        <span className="modal-hint">
          {kind === "arena" ? "选三位选手同桌对战，全程围观思考" : "选两位 AI 对手，你亲自上桌"}
        </span>
      </div>
      {botModels.length ? (
        <LineupPicker
          seats={seats}
          botModels={botModels}
          picks={picks}
          onPick={(seat, index) => {
            setPicks((current) => current.map((pick, position) => (position === seat ? index : pick)));
          }}
          effort={effort}
          onEffort={setEffort}
        >
          <button
            type="button"
            className="btn-img btn-img-ai btn-img-sm arena-create-button"
            disabled={busy}
            onClick={() => onSubmit(lineupFromPicks(picks, botModels), effort)}
          >
            {kind === "arena" ? "开赛并观战" : "上桌开打"}
          </button>
        </LineupPicker>
      ) : (
        <p className="empty-state">服务端未配置可用模型，暂时无法开局</p>
      )}
      {status ? <p className="home-status">{status}</p> : null}
    </Modal>
  );
}

/** 记住的阵容翻回 picks 下标；任一模型已不在清单则整组弃用（回默认错开选择）。 */
function picksFromModels(
  models: readonly BotModelRefDto[] | undefined,
  botModels: readonly BotModelOption[]
): number[] | null {
  if (!models) {
    return null;
  }
  const picks = models.map((model) =>
    botModels.findIndex((option) => option.provider === model.provider && option.model === model.model)
  );
  return picks.length && picks.every((pick) => pick >= 0) ? picks : null;
}

function pct(part: number, total: number): string {
  return total === 0 ? "-" : `${((part / total) * 100).toFixed(1)}%`;
}

/** 模型排行榜（匿名可见）：聚合全部已结束对局，按总胜率排序 */
function LeaderboardPanel({ api }: { readonly api: ApiClient }) {
  const [entries, setEntries] = useState<readonly LeaderboardEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLeaderboard()
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
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) {
    return <p className="empty-state">{error}</p>;
  }
  if (entries === null) {
    return <p className="empty-state">加载中…</p>;
  }
  if (!entries.length) {
    return <p className="empty-state">暂无对局数据，先开一场吧</p>;
  }
  return (
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
              <span>
                {entry.wins}/{entry.games} 胜
              </span>
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
  );
}

/** 正在直播的竞技场房间列表：点击进入观战 */
function LiveRoomsPanel({ rooms }: { readonly rooms: readonly RoomDto[] }) {
  const navigate = useNavigate();

  if (!rooms.length) {
    return <p className="empty-state">暂无直播，开一场吧</p>;
  }
  return (
    <div className="room-list">
      {rooms.slice(0, 8).map((room) => (
        <button
          type="button"
          key={room.id}
          className="room-row"
          onClick={() => void navigate(`/arena/${room.code}`)}
        >
          <span className="room-medal">播</span>
          <span className="room-copy">
            <strong>{room.code}</strong>
            <span>{room.status === "playing" ? "对战进行中" : "等待开赛"}</span>
          </span>
          <span className="room-enter">观战</span>
        </button>
      ))}
    </div>
  );
}

/** 最近公开 AI 对局（匿名可见）：复盘入口 */
function RecentReplaysPanel({ api }: { readonly api: ApiClient }) {
  const navigate = useNavigate();
  const [rounds, setRounds] = useState<readonly RoundHistoryItemDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listRecentReplays()
      .then((response) => {
        if (!cancelled) {
          setRounds(response.rounds);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!rounds.length) {
    return <p className="empty-state">暂无公开对局</p>;
  }
  return (
    <ul className="recent-replays-list">
      {rounds.map((round) => {
        const landlordWon = round.players.some(
          (player) => player.playerId === round.landlordId && player.score > 0
        );
        return (
          <li key={round.id} className="recent-replay-row">
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
              className="btn-img btn-img-green btn-img-sm"
              onClick={() => void navigate(`/replay/${round.id}`)}
            >
              复盘
            </button>
          </li>
        );
      })}
    </ul>
  );
}
