import { GameTable } from "@ddz/domain";
import type { RoomLiveStateEnvelope } from "@ddz/protocol";

/** 恢复出「human-1 地主、bot:100031:1 行动」的出牌相位牌桌;失败/重试类测试共用。 */
export function playingTable(): GameTable {
  const table = new GameTable();
  table.restore({
    phase: "playing",
    players: [
      {
        id: "human-1",
        kind: "human",
        seat: 0,
        ready: false,
        connected: true,
        hand: ["3-diamonds"],
        score: 0
      },
      {
        id: "bot:100031:1",
        kind: "bot",
        seat: 1,
        ready: false,
        connected: true,
        hand: ["4-diamonds"],
        score: 0
      },
      {
        id: "bot:100031:2",
        kind: "bot",
        seat: 2,
        ready: false,
        connected: true,
        hand: ["5-diamonds"],
        score: 0
      }
    ],
    currentPlayerId: "bot:100031:1",
    landlordId: "human-1",
    bidCandidateId: null,
    firstBidderId: null,
    landlordCards: ["6-diamonds", "7-diamonds", "8-diamonds"],
    bottomCards: [],
    lastPlay: {
      playerId: "human-1",
      cards: ["3-diamonds"]
    },
    settlement: null,
    passCount: 0,
    bidAttempts: 0,
    robQueue: [],
    robIndex: 0,
    robCount: 0,
    bombCount: 0,
    playCounts: {
      "human-1": 1
    },
    playHistory: [{ type: "play", playerId: "human-1", cards: ["3-diamonds"] }]
  } satisfies RoomLiveStateEnvelope["table"]);
  return table;
}
