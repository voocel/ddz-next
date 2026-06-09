import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RoundReplayDto } from "@ddz/protocol";

interface ReplayPlaybackInput {
  readonly replayPlaying: boolean;
  readonly replayStep: number;
  readonly selectedReplay: RoundReplayDto | null;
  readonly setReplayPlaying: Dispatch<SetStateAction<boolean>>;
  readonly setReplayStep: Dispatch<SetStateAction<number>>;
}

export function useReplayPlayback(input: ReplayPlaybackInput): void {
  const { replayPlaying, replayStep, selectedReplay, setReplayPlaying, setReplayStep } = input;

  useEffect(() => {
    if (!selectedReplay || !replayPlaying) {
      return;
    }

    if (replayStep >= selectedReplay.actions.length - 1) {
      setReplayPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setReplayStep((step) => Math.min(selectedReplay.actions.length - 1, step + 1));
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [replayPlaying, replayStep, selectedReplay, setReplayPlaying, setReplayStep]);
}
