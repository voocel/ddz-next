import { z } from "zod";

export const rankSchema = z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "SJ", "BJ"]);
export const suitSchema = z.enum(["clubs", "diamonds", "hearts", "spades"]);
export const cardIdSchema = z.union([
  z.literal("SJ"),
  z.literal("BJ"),
  z.templateLiteral([
    z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]),
    z.literal("-"),
    suitSchema
  ])
]);

export const cardSchema = z.object({
  id: cardIdSchema,
  rank: rankSchema,
  suit: suitSchema.optional()
});

export const playerSnapshotSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["human", "bot"]),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  ready: z.boolean(),
  handCount: z.number().int().min(0).max(20),
  connected: z.boolean(),
  score: z.number().int()
});

export const gamePhaseSchema = z.enum(["waiting", "ready", "bidding", "robbing", "playing", "settled"]);

export const combinationKindSchema = z.enum([
  "single",
  "pair",
  "trio",
  "trio_with_single",
  "trio_with_pair",
  "straight",
  "pair_sequence",
  "plane",
  "plane_with_singles",
  "plane_with_pairs",
  "four_with_two_singles",
  "four_with_two_pairs",
  "bomb",
  "rocket"
]);

export const combinationSchema = z.object({
  kind: combinationKindSchema,
  cards: z.array(cardSchema),
  mainRank: rankSchema,
  length: z.number().int().positive(),
  chainLength: z.number().int().positive().optional()
});

export const publicPlaySchema = z.object({
  playerId: z.string().min(1),
  cards: z.array(cardSchema),
  combination: combinationSchema
});

export const settlementPlayerSchema = z.object({
  playerId: z.string().min(1),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  role: z.enum(["landlord", "farmer"]),
  handCount: z.number().int().min(0).max(20),
  scoreDelta: z.number().int(),
  totalScore: z.number().int()
});

export const settlementSchema = z.object({
  winnerId: z.string().min(1),
  landlordId: z.string().min(1),
  landlordWon: z.boolean(),
  baseScore: z.number().int().positive(),
  players: z.array(settlementPlayerSchema).length(3)
}).refine((settlement) => settlement.players.reduce((total, player) => total + player.scoreDelta, 0) === 0, {
  message: "Settlement score deltas must be zero-sum.",
  path: ["players"]
});

export const gameSnapshotSchema = z.object({
  phase: gamePhaseSchema,
  players: z.array(playerSnapshotSchema),
  currentPlayerId: z.string().nullable(),
  landlordId: z.string().nullable(),
  bidCandidateId: z.string().nullable(),
  landlordCards: z.array(cardSchema),
  lastPlay: publicPlaySchema.nullable(),
  passCount: z.number().int().min(0).max(2),
  settlement: settlementSchema.nullable()
});

export const readyCommandSchema = z.object({
  type: z.literal("ready")
});

export const bidLandlordCommandSchema = z.object({
  type: z.literal("bid_landlord"),
  called: z.boolean()
});

export const robLandlordCommandSchema = z.object({
  type: z.literal("rob_landlord"),
  robbed: z.boolean()
});

export const playCardsCommandSchema = z.object({
  type: z.literal("play_cards"),
  cards: z.array(cardIdSchema).min(1).max(20)
});

export const passCommandSchema = z.object({
  type: z.literal("pass")
});

export const leaveCommandSchema = z.object({
  type: z.literal("leave_room")
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  readyCommandSchema,
  bidLandlordCommandSchema,
  robLandlordCommandSchema,
  playCardsCommandSchema,
  passCommandSchema,
  leaveCommandSchema
]);

export const gameEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("player_joined"),
    playerId: z.string().min(1),
    seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    snapshot: gameSnapshotSchema
  }),
  z.object({
    type: z.literal("player_connection_changed"),
    playerId: z.string().min(1),
    connected: z.boolean(),
    snapshot: gameSnapshotSchema
  }),
  z.object({
    type: z.literal("player_ready"),
    playerId: z.string().min(1)
  }),
  z.object({
    type: z.literal("round_started"),
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("landlord_bid"),
    playerId: z.string().min(1),
    called: z.boolean(),
    redealt: z.boolean(),
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("landlord_robbed"),
    playerId: z.string().min(1),
    robbed: z.boolean(),
    decided: z.boolean(),
    landlordId: z.string().nullable(),
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("cards_played"),
    play: publicPlaySchema,
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("round_settled"),
    settlement: settlementSchema,
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema)
  }),
  z.object({
    type: z.literal("player_passed"),
    playerId: z.string().min(1),
    snapshot: gameSnapshotSchema
  }),
  z.object({
    type: z.literal("turn_timer"),
    playerId: z.string().min(1),
    deadlineAt: z.string().datetime(),
    durationMs: z.number().int().positive(),
    snapshot: gameSnapshotSchema
  }),
  z.object({
    type: z.literal("command_rejected"),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("room_failed"),
    reason: z.string().min(1)
  })
]);

export const loginRequestSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(128)
});

export const registerRequestSchema = z.object({
  username: z.string().min(3).max(32),
  nickname: z.string().min(1).max(32),
  password: z.string().min(6).max(128)
});

export const authUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  nickname: z.string().min(1)
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: authUserSchema
});

export const roomStatusSchema = z.enum(["open", "playing", "closed"]);

export const roomSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(4).max(12),
  status: roomStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const createRoomRequestSchema = z.object({
  code: z.string().min(4).max(12).regex(/^[A-Z0-9]+$/).optional()
});

export const updateRoomStatusRequestSchema = z.object({
  status: roomStatusSchema
});

export const roomActionTypeSchema = z.enum([
  "player_joined",
  "player_left",
  "player_ready",
  "room_failed"
]);

export const roundActionTypeSchema = z.enum([
  "landlord_bid",
  "landlord_robbed",
  "cards_played",
  "player_passed",
  "round_started",
  "round_settled"
]);

export const gameActionTypeSchema = z.union([roomActionTypeSchema, roundActionTypeSchema]);

export const recordGameActionSchema = z.object({
  playerId: z.string().min(1).nullable(),
  playerKind: z.enum(["human", "bot"]).nullable(),
  type: gameActionTypeSchema,
  payload: z.record(z.string(), z.unknown())
});

export const recordGameActionRequestSchema = z.object({
  roomCode: z.string().min(4).max(12).regex(/^[A-Z0-9]+$/),
  mutationId: z.string().uuid(),
  actions: z.array(recordGameActionSchema).min(1)
});

export const roundSettledPayloadSchema = z.object({
  settlement: settlementSchema
});

export const roomListResponseSchema = z.object({
  rooms: z.array(roomSchema)
});

export const roomResponseSchema = z.object({
  room: roomSchema
});

export const internalRoomJoinResponseSchema = z.object({
  room: roomSchema
});

export const roundHistoryActionSchema = z.object({
  id: z.string().min(1),
  type: roundActionTypeSchema,
  playerId: z.string().min(1).nullable(),
  playerKind: z.enum(["human", "bot"]).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime()
});

export const roundHistoryPlayerSchema = z.object({
  playerId: z.string().min(1),
  playerKind: z.enum(["human", "bot"]),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  score: z.number().int(),
  coinDelta: z.number().int()
});

export const roundHistoryItemSchema = z.object({
  id: z.string().min(1),
  roomCode: z.string().min(4).max(12),
  landlordId: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  players: z.array(roundHistoryPlayerSchema)
});

export const roundHistoryResponseSchema = z.object({
  rounds: z.array(roundHistoryItemSchema)
});

export const roundReplaySchema = roundHistoryItemSchema.extend({
  actions: z.array(roundHistoryActionSchema)
});

export const roundReplayResponseSchema = z.object({
  round: roundReplaySchema
});

export const coinLedgerItemSchema = z.object({
  id: z.string().min(1),
  roundId: z.string().min(1),
  roomCode: z.string().min(4).max(12),
  delta: z.number().int(),
  balance: z.number().int(),
  reason: z.string().min(1),
  createdAt: z.string().datetime()
});

export const coinLedgerResponseSchema = z.object({
  ledgers: z.array(coinLedgerItemSchema)
});

export type CardDto = z.infer<typeof cardSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameSnapshotDto = z.infer<typeof gameSnapshotSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type UpdateRoomStatusRequest = z.infer<typeof updateRoomStatusRequestSchema>;
export type RoomActionType = z.infer<typeof roomActionTypeSchema>;
export type RoundActionType = z.infer<typeof roundActionTypeSchema>;
export type GameActionType = z.infer<typeof gameActionTypeSchema>;
export type RecordGameAction = z.infer<typeof recordGameActionSchema>;
export type RecordGameActionRequest = z.infer<typeof recordGameActionRequestSchema>;
export type RoomDto = z.infer<typeof roomSchema>;
export type RoomListResponse = z.infer<typeof roomListResponseSchema>;
export type RoomResponse = z.infer<typeof roomResponseSchema>;
export type InternalRoomJoinResponse = z.infer<typeof internalRoomJoinResponseSchema>;
export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type SettlementDto = z.infer<typeof settlementSchema>;
export type RoundHistoryActionDto = z.infer<typeof roundHistoryActionSchema>;
export type RoundHistoryPlayerDto = z.infer<typeof roundHistoryPlayerSchema>;
export type RoundHistoryItemDto = z.infer<typeof roundHistoryItemSchema>;
export type RoundHistoryResponse = z.infer<typeof roundHistoryResponseSchema>;
export type RoundReplayDto = z.infer<typeof roundReplaySchema>;
export type RoundReplayResponse = z.infer<typeof roundReplayResponseSchema>;
export type CoinLedgerItemDto = z.infer<typeof coinLedgerItemSchema>;
export type CoinLedgerResponse = z.infer<typeof coinLedgerResponseSchema>;
