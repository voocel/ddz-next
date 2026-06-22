import type { GameSnapshotDto } from "@ddz/protocol";
import { formatActor, formatScore } from "../../game/tablePresentation";

interface SettlementPanelProps {
  readonly snapshot: GameSnapshotDto;
  readonly localPlayerId: string;
  readonly canReady: boolean;
  readonly onReady: () => void;
  readonly onLeave: () => void;
}

export function SettlementPanel({ snapshot, localPlayerId, canReady, onReady, onLeave }: SettlementPanelProps) {
  if (!snapshot.settlement) {
    return null;
  }

  const { settlement } = snapshot;
  const localResult = settlement.players.find((player) => player.playerId === localPlayerId);
  const localWon = localResult ? localResult.scoreDelta > 0 : settlement.winnerId === localPlayerId;
  const winnerName = actorName(snapshot, settlement.winnerId, localPlayerId);
  const rows = settlement.players.slice().sort((a, b) => a.seat - b.seat);

  return (
    <section className="settlement-overlay" aria-label="本局结算">
      <div className="settlement-panel">
        <div className="settlement-ribbon">本局结算</div>
        <div className="settlement-panel-body">
          <div className={`settlement-result${localWon ? " is-win" : " is-lose"}`}>{localWon ? "胜利" : "惜败"}</div>
          <h2>{winnerName} 获得本局胜利</h2>

          <div className="settlement-metrics">
            <Metric label="地主" value={actorName(snapshot, settlement.landlordId, localPlayerId)} />
            <Metric label="倍数" value={`x${settlement.multiplier}`} />
            <Metric label="底分" value={String(settlement.baseScore)} />
            {settlement.spring ? <span className="settlement-spring">春天</span> : null}
          </div>

          <div className="settlement-scoreboard">
            <div className="settlement-scoreboard-head">
              <span>玩家</span>
              <span>身份</span>
              <span>本局</span>
              <span>总分</span>
            </div>
            {rows.map((player) => {
              const won = player.scoreDelta > 0;
              const role = player.role === "landlord" ? "地主" : "农民";
              return (
                <div key={player.playerId} className={`settlement-row${won ? " is-winner" : ""}`}>
                  <span className="settlement-player">
                    {won ? <span className="settlement-winner-mark" aria-hidden>▲</span> : null}
                    {actorName(snapshot, player.playerId, localPlayerId)}
                  </span>
                  <span className={`settlement-role settlement-role--${player.role}`}>{role}</span>
                  <span className={`settlement-delta${player.scoreDelta > 0 ? " is-positive" : player.scoreDelta < 0 ? " is-negative" : ""}`}>
                    {formatScore(player.scoreDelta)}
                  </span>
                  <span>{player.totalScore}</span>
                </div>
              );
            })}
          </div>

          <div className="settlement-actions">
            {canReady ? (
              <button type="button" className="btn-img btn-img-orange" onClick={onReady}>
                准备
              </button>
            ) : null}
            <button type="button" className="btn-img btn-img-wood" onClick={onLeave}>
              返回大厅
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="settlement-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function actorName(snapshot: GameSnapshotDto, playerId: string, localPlayerId: string): string {
  const player = snapshot.players.find((item) => item.id === playerId);
  return formatActor(playerId, localPlayerId, player?.nickname);
}
