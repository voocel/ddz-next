import type { GameSnapshotDto } from "@ddz/protocol";
import type { ThemeId } from "../../theme";
import { TurnClock } from "./TurnClock";
import type { TurnTimerState } from "../types";

export function SeatTurnClock({
  snapshot,
  turnTimer,
  localPlayerId,
  theme
}: {
  readonly snapshot: GameSnapshotDto | null;
  readonly turnTimer: TurnTimerState | null;
  readonly localPlayerId: string;
  readonly theme: ThemeId;
}) {
  if (!snapshot || !turnTimer) {
    return null;
  }

  const localSeat = snapshot.players.find((player) => player.id === localPlayerId)?.seat ?? null;
  const timerSeat = snapshot.players.find((player) => player.id === turnTimer.playerId)?.seat ?? null;
  if (timerSeat === null) {
    return null;
  }

  const relative = localSeat === null ? timerSeat : (timerSeat - localSeat + 3) % 3;
  if (relative === 0) {
    return null;
  }
  const side = relative === 1 ? "right" : "left";

  return (
    <div className="seat-clock-layer" aria-live="polite">
      <div className={`seat-clock seat-clock--${side}`}>
        <TurnClock theme={theme} remainingMs={turnTimer.remainingMs} local={false} />
      </div>
    </div>
  );
}
