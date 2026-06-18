import { COMBINATION_KINDS, GAME_PHASES, RANKS, SUITS } from "@ddz/domain";
import type {
  Card,
  Combination,
  CombinationKind,
  GamePhase,
  GameSnapshot,
  GameTablePlayerState,
  GameTableState,
  PublicPlay,
  Rank,
  Settlement,
  Suit
} from "@ddz/domain";
import { z } from "zod";

/**
 * 同一玩家新连接踢掉旧会话时的自定义 WebSocket 关闭码，game-server 与 web 共用。
 * 4000-4010 已被 Colyseus CloseCode 占用（4002 = WITH_ERROR），自定义码必须避开。
 */
export const DUPLICATE_SESSION_CLOSE_CODE = 4100;

// 与 @ddz/domain 共享的 schema 一律从 domain 常量派生并用 satisfies 锁定输出类型，
// domain 改动时这里会编译期报错，防止两份定义漂移。
export const rankSchema = z.enum(RANKS) satisfies z.ZodType<Rank>;
export const suitSchema = z.enum(SUITS) satisfies z.ZodType<Suit>;
export const cardIdSchema = z.union([
  z.literal("SJ"),
  z.literal("BJ"),
  z.templateLiteral([
    z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]),
    z.literal("-"),
    suitSchema
  ])
]);

export const cardSchema = z
  .object({
    id: cardIdSchema,
    rank: rankSchema,
    suit: suitSchema.optional()
  })
  .refine(
    (card) =>
      card.id === "SJ" || card.id === "BJ"
        ? card.rank === card.id && card.suit === undefined
        : card.suit !== undefined && card.id === `${card.rank}-${card.suit}`,
    { message: "Card id must match its rank and suit." }
  ) satisfies z.ZodType<Card>;

export const playerSnapshotSchema = z.object({
  id: z.string().min(1),
  // 展示用昵称；旧快照/bot 可能缺省，前端按 id 规则兜底
  nickname: z.string().min(1).optional(),
  kind: z.enum(["human", "bot"]),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  ready: z.boolean(),
  handCount: z.number().int().min(0).max(20),
  connected: z.boolean(),
  score: z.number().int()
});

export const gamePhaseSchema = z.enum(GAME_PHASES) satisfies z.ZodType<GamePhase>;

export const combinationKindSchema = z.enum(COMBINATION_KINDS) satisfies z.ZodType<CombinationKind>;

export const combinationSchema = z
  .object({
    kind: combinationKindSchema,
    cards: z.array(cardSchema).max(20),
    mainRank: rankSchema,
    length: z.number().int().positive(),
    chainLength: z.number().int().positive().optional()
  })
  .refine((combination) => combination.cards.length === combination.length, {
    message: "Combination length must match its card count.",
    path: ["length"]
  }) satisfies z.ZodType<Combination>;

export const publicPlaySchema = z.object({
  playerId: z.string().min(1),
  cards: z.array(cardSchema),
  combination: combinationSchema
}) satisfies z.ZodType<PublicPlay>;

export const settlementPlayerSchema = z.object({
  playerId: z.string().min(1),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  role: z.enum(["landlord", "farmer"]),
  handCount: z.number().int().min(0).max(20),
  scoreDelta: z.number().int(),
  totalScore: z.number().int()
});

export const settlementSchema = z
  .object({
    winnerId: z.string().min(1),
    landlordId: z.string().min(1),
    landlordWon: z.boolean(),
    baseScore: z.number().int().positive(),
    // default 兼容历史落库数据（multiplier/spring 引入前的对局回放）。
    multiplier: z.number().int().min(1).default(1),
    spring: z.boolean().default(false),
    players: z.array(settlementPlayerSchema).length(3)
  })
  .refine((settlement) => settlement.players.reduce((total, player) => total + player.scoreDelta, 0) === 0, {
    message: "Settlement score deltas must be zero-sum.",
    path: ["players"]
  })
  .refine((settlement) => new Set(settlement.players.map((player) => player.playerId)).size === settlement.players.length, {
    message: "Settlement players must be unique.",
    path: ["players"]
  })
  .refine((settlement) => new Set(settlement.players.map((player) => player.seat)).size === settlement.players.length, {
    message: "Settlement seats must be unique.",
    path: ["players"]
  })
  .refine((settlement) => settlement.players.filter((player) => player.role === "landlord").length === 1, {
    message: "Settlement must contain exactly one landlord.",
    path: ["players"]
  }) satisfies z.ZodType<Settlement>;

export const gameSnapshotSchema = z.object({
  phase: gamePhaseSchema,
  players: z.array(playerSnapshotSchema),
  currentPlayerId: z.string().nullable(),
  landlordId: z.string().nullable(),
  bidCandidateId: z.string().nullable(),
  landlordCards: z.array(cardSchema),
  lastPlay: publicPlaySchema.nullable(),
  passCount: z.number().int().min(0).max(2),
  multiplier: z.number().int().min(1).default(1),
  settlement: settlementSchema.nullable()
}) satisfies z.ZodType<GameSnapshot>;

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
    playerId: z.string().min(1),
    snapshot: gameSnapshotSchema
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
  }),
  z.object({
    type: z.literal("bot_chat"),
    playerId: z.string().min(1),
    nickname: z.string().min(1).optional(),
    text: z.string().min(1).max(120)
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

/** 房间号统一格式：6 位数字（便于输入/口述）。这是 api 生成校验、game-server 入房校验、web 输入的唯一格式来源，禁止各处再写正则。 */
export const ROOM_CODE_REGEX = /^\d{6}$/;
export const roomCodeSchema = z.string().regex(ROOM_CODE_REGEX, "房间号必须是 6 位数字");

/** 机器人出牌决策来源：rule 规则引擎、llm 大模型。 */
export type BotDecisionMode = "rule" | "llm";

/**
 * GET /bot-models 响应:可选机器人模型清单(无密钥) + 服务端默认选择。web 拉取后据此渲染下拉。
 * 可选模型由 game-server 从供应商注册表(bot-providers.json)动态下发,服务端按注册表校验客户端所选;
 * API key 始终只在服务端,客户端只见 provider/model 标签。
 */
export const botModelOptionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** provider 展示名(下拉分组标题)。 */
  providerLabel: z.string()
});
export const botModelsResponseSchema = z.object({
  default: z.object({ provider: z.string(), model: z.string() }),
  models: z.array(botModelOptionSchema)
});
export type BotModelOption = z.infer<typeof botModelOptionSchema>;
export type BotModelsResponse = z.infer<typeof botModelsResponseSchema>;

export const createRoomRequestSchema = z.object({
  code: roomCodeSchema.optional()
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

export const gameTablePlayerStateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["human", "bot"]),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  ready: z.boolean(),
  connected: z.boolean(),
  hand: z.array(cardIdSchema).max(20),
  score: z.number().int()
}) satisfies z.ZodType<GameTablePlayerState>;

// 崩溃恢复用的完整牌桌状态（含手牌）。安全红线：只经 internal 通道传输，绝不并入公开响应/action payload。
export const gameTableStateSchema = z.object({
  phase: gamePhaseSchema,
  players: z.array(gameTablePlayerStateSchema).max(3),
  currentPlayerId: z.string().min(1).nullable(),
  landlordId: z.string().min(1).nullable(),
  bidCandidateId: z.string().min(1).nullable(),
  firstBidderId: z.string().min(1).nullable(),
  landlordCards: z.array(cardIdSchema).max(3),
  bottomCards: z.array(cardIdSchema).max(3),
  lastPlay: z
    .object({
      playerId: z.string().min(1),
      cards: z.array(cardIdSchema).min(1).max(20)
    })
    .nullable(),
  settlement: settlementSchema.nullable(),
  passCount: z.number().int().min(0).max(2),
  bidAttempts: z.number().int().min(0),
  // 反抢会把首叫者追加进队列（其余两人 + 首叫者），故上限为 3
  robQueue: z.array(z.string().min(1)).max(3),
  robIndex: z.number().int().min(0),
  robCount: z.number().int().min(0),
  bombCount: z.number().int().min(0),
  playCounts: z.record(z.string(), z.number().int().min(0))
}) satisfies z.ZodType<GameTableState>;

/** 牌局恢复信封：版本号留迁移余地；nicknames 是 DdzRoom 从 JWT 收集的展示昵称 */
export interface RoomLiveStateEnvelope {
  readonly version: 1;
  readonly table: GameTableState;
  readonly nicknames: Readonly<Record<string, string>>;
}

export const roomLiveStateEnvelopeSchema = z.object({
  version: z.literal(1),
  table: gameTableStateSchema,
  nicknames: z.record(z.string(), z.string().min(1))
}) satisfies z.ZodType<RoomLiveStateEnvelope>;

export const recordGameActionRequestSchema = z.object({
  roomCode: roomCodeSchema,
  mutationId: z.string().uuid(),
  actions: z.array(recordGameActionSchema).min(1),
  // 同事务 upsert 到 RoomLiveState，供崩溃恢复
  state: roomLiveStateEnvelopeSchema.optional()
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

export const internalRoomStateResponseSchema = z.object({
  room: roomSchema,
  state: roomLiveStateEnvelopeSchema.nullable()
});

// 匹配通道服务端推送：排队状态 / 撮合成功 / 撮合失败
export const matchmakingEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("queue_status"),
    waiting: z.number().int().min(0),
    position: z.number().int().min(1)
  }),
  z.object({
    type: z.literal("matched"),
    room: roomSchema
  }),
  z.object({
    type: z.literal("match_failed"),
    message: z.string().min(1)
  })
]);

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
  nickname: z.string().min(1).optional(),
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
export type InternalRoomStateResponse = z.infer<typeof internalRoomStateResponseSchema>;
export type MatchmakingEvent = z.infer<typeof matchmakingEventSchema>;
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
