import { describe, expect, it } from "vitest";
import type { GameSnapshotDto } from "@ddz/protocol";
import { getTableControlsState } from "./controlsState";

describe("table controls state", () => {
  it("disables every table action outside a room", () => {
    expect(getTableControlsState(null, "p0", false)).toEqual({
      ready: false,
      bid: false,
      rob: false,
      pass: false,
      leave: false
    });
  });

  it("enables ready before the local player is ready", () => {
    expect(getTableControlsState(snapshot("ready", { currentPlayerId: null, localReady: false }), "p0", true)).toMatchObject({
      ready: true,
      bid: false,
      rob: false,
      pass: false,
      leave: true
    });
  });

  it("enables ready on settlement so the local player controls when the next round starts", () => {
    expect(getTableControlsState(snapshot("settled", { currentPlayerId: null, localReady: false }), "p0", true).ready).toBe(true);
    expect(getTableControlsState(snapshot("settled", { currentPlayerId: null, localReady: true }), "p0", true).ready).toBe(true);
  });

  it("enables bidding only on the local bidding turn", () => {
    expect(getTableControlsState(snapshot("bidding", { currentPlayerId: "p0", localReady: true }), "p0", true).bid).toBe(true);
    expect(getTableControlsState(snapshot("bidding", { currentPlayerId: "p1", localReady: true }), "p0", true).bid).toBe(false);
  });

  it("enables pass and play controls only on the local playing turn", () => {
    expect(getTableControlsState(snapshot("playing", { currentPlayerId: "p0", localReady: true }), "p0", true).pass).toBe(true);
    expect(getTableControlsState(snapshot("playing", { currentPlayerId: "p2", localReady: true }), "p0", true).pass).toBe(false);
  });
});

function snapshot(
  phase: GameSnapshotDto["phase"],
  options: { readonly currentPlayerId: string | null; readonly localReady: boolean }
): GameSnapshotDto {
  return {
    phase,
    players: [
      { id: "p0", kind: "human", seat: 0, ready: options.localReady, handCount: 17, connected: true, score: 0 },
      { id: "p1", kind: "human", seat: 1, ready: true, handCount: 17, connected: true, score: 0 },
      { id: "p2", kind: "human", seat: 2, ready: true, handCount: 17, connected: true, score: 0 }
    ],
    currentPlayerId: options.currentPlayerId,
    landlordId: null,
    bidCandidateId: null,
    landlordCards: [],
    lastPlay: null,
    passCount: 0,
    multiplier: 1,
    settlement: null
  };
}
