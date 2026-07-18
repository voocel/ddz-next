import { COMBINATION_KINDS, GAME_PHASES, RANKS, SUITS } from "@ddz/domain";
import type {
  Card,
  Combination,
  CombinationKind,
  GamePhase,
  GameSnapshot,
  GameTableHistoryEntry,
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

/** LLM bot 的模型身份(provider+model);快照/结算/流局 payload 共用。 */
export const botModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1)
});

export const playerSnapshotSchema = z.object({
  id: z.string().min(1),
  // 展示用昵称；旧快照/bot 可能缺省，前端按 id 规则兜底
  nickname: z.string().min(1).optional(),
  kind: z.enum(["human", "bot"]),
  seat: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  ready: z.boolean(),
  handCount: z.number().int().min(0).max(20),
  connected: z.boolean(),
  score: z.number().int(),
  /** LLM bot 席位的模型身份;真人与规则 bot 缺省。观战/竞技场据此展示哪个模型坐哪。 */
  model: botModelRefSchema.optional()
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

export const updateBotSettingsCommandSchema = z.object({
  type: z.literal("update_bot_settings"),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.enum(["auto", "off", "low", "medium", "high"])
});

export const retryBotTurnCommandSchema = z.object({
  type: z.literal("retry_bot_turn")
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  readyCommandSchema,
  bidLandlordCommandSchema,
  robLandlordCommandSchema,
  playCardsCommandSchema,
  passCommandSchema,
  leaveCommandSchema,
  updateBotSettingsCommandSchema,
  retryBotTurnCommandSchema
]);

const revealedHandSchema = z.object({
  playerId: z.string().min(1),
  cards: z.array(cardSchema)
});
const revealedHandsSchema = z.array(revealedHandSchema);

export const gameEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    snapshot: gameSnapshotSchema,
    hand: z.array(cardSchema),
    /** 若当前处于结算态,服务端可附带全员剩余手牌,供刷新/重连后继续展示明牌。 */
    revealedHands: revealedHandsSchema.optional()
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
    hand: z.array(cardSchema),
    /** 结算后公开所有玩家剩余手牌,用于翻开对手牌给全桌复盘。 */
    revealedHands: revealedHandsSchema.optional()
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
    type: z.literal("bot_settings_updated"),
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.enum(["auto", "off", "low", "medium", "high"])
  }),
  z.object({
    type: z.literal("room_failed"),
    reason: z.string().min(1)
  }),
  z.object({
    type: z.literal("bot_decision_failed"),
    playerId: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    /** 本回合第几次决策失败(1 基);缺省表示服务端未启用自动重试计数。 */
    attempt: z.number().int().positive().optional(),
    /** true 表示服务端将按退避自动重试,前端只需展示等待;false/缺省表示等待手动重试。 */
    willRetry: z.boolean().optional(),
    snapshot: gameSnapshotSchema
  }),
  // 竞技场流局:LLM 决策耗尽重试后放弃本局(不产生结算,累计分不变),failedPlayerId 记技术负。
  z.object({
    type: z.literal("round_aborted"),
    reason: z.string().min(1),
    failedPlayerId: z.string().min(1).nullable(),
    snapshot: gameSnapshotSchema
  }),
  // 赛事解说:全局旁白短句(非流式),仅竞技场房广播;与 bot_ai_stream(席位第一人称思考流)是不同内容层。
  z.object({
    type: z.literal("commentary"),
    text: z.string().min(1).max(200),
    /** 触发场景标签(opening/landlord/bomb/endgame/settlement 等),前端可按需做样式区分。 */
    tag: z.string().min(1).max(32).optional()
  }),
  z.object({
    type: z.literal("bot_chat"),
    playerId: z.string().min(1),
    nickname: z.string().min(1).optional(),
    text: z.string().min(1).max(120)
  }),
  // 大模型出牌时的「AI 输出流」:reasoning 与普通文本增量,服务端按字数节流后广播。
  // text 为节流后的片段(done 收尾时可为空);done=true 表示本手输出结束。
  z.object({
    type: z.literal("bot_ai_stream"),
    playerId: z.string().min(1),
    channel: z.enum(["reasoning", "text"]),
    text: z.string().max(600),
    done: z.boolean(),
    /** 本手 LLM 最终选中的候选项;index 是内部 0 基索引,展示编号用 index + 1。 */
    choice: z
      .object({
        index: z.number().int().nonnegative(),
        label: z.string().min(1).max(120)
      })
      .optional()
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

/** 房间玩法模式:standard=常规(真人可参与);arena=全 AI 对战房(供直播列表过滤,不做行为分支依据)。 */
export const roomModeSchema = z.enum(["standard", "arena"]);

export const roomSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(4).max(12),
  status: roomStatusSchema,
  mode: roomModeSchema.default("standard"),
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
  code: roomCodeSchema.optional(),
  mode: roomModeSchema.optional()
});

export const updateRoomStatusRequestSchema = z.object({
  ownerId: z.string().min(1).max(160),
  status: roomStatusSchema
});

export const roomClaimRequestSchema = z.object({
  ownerId: z.string().min(1).max(160),
  ttlMs: z.number().int().min(5_000).max(30 * 60_000)
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
  "round_settled",
  "round_aborted"
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

const gameTableHistoryEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play"),
    playerId: z.string().min(1),
    cards: z.array(cardIdSchema).min(1).max(20)
  }),
  z.object({
    type: z.literal("pass"),
    playerId: z.string().min(1)
  }),
  z.object({
    type: z.literal("bid"),
    playerId: z.string().min(1),
    called: z.boolean()
  }),
  z.object({
    type: z.literal("rob"),
    playerId: z.string().min(1),
    robbed: z.boolean()
  })
]) satisfies z.ZodType<GameTableHistoryEntry>;

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
  playCounts: z.record(z.string(), z.number().int().min(0)),
  playHistory: z.array(gameTableHistoryEntrySchema)
}) satisfies z.ZodType<GameTableState>;

/** 牌局恢复信封：版本号留迁移余地；nicknames 是 DdzRoom 从 JWT 收集的展示昵称 */
export interface RoomLiveStateEnvelope {
  readonly version: 1;
  readonly table: GameTableState;
  readonly nicknames: Readonly<Record<string, string>>;
  /** 参局 LLM bot 的模型身份(playerId → provider/model);崩溃恢复时据此重建各席位大脑,缺失走房间默认大脑。 */
  readonly botModels?: Readonly<Record<string, { readonly provider: string; readonly model: string }>> | undefined;
  /** 全 AI 竞技场房标记;恢复时还原观战语义与局间自动推进。 */
  readonly arena?: boolean | undefined;
}

export const roomLiveStateEnvelopeSchema = z.object({
  version: z.literal(1),
  table: gameTableStateSchema,
  nicknames: z.record(z.string(), z.string().min(1)),
  botModels: z.record(z.string(), botModelRefSchema).optional(),
  arena: z.boolean().optional()
}) satisfies z.ZodType<RoomLiveStateEnvelope>;

export const recordGameActionRequestSchema = z.object({
  roomCode: roomCodeSchema,
  ownerId: z.string().min(1).max(160),
  mutationId: z.string().uuid(),
  actions: z.array(recordGameActionSchema).min(1),
  /** 与动作同事务更新的目标房间状态；未提供时只记录动作/状态快照。 */
  status: roomStatusSchema.optional(),
  // 同事务 upsert 到 RoomLiveState，供崩溃恢复
  state: roomLiveStateEnvelopeSchema.optional()
});

/** 参局 LLM bot 的模型身份(playerId → provider/model);规则 bot 局无此字段。 */
const botPlayersSchema = z.record(z.string(), botModelRefSchema).optional();

export const roundSettledPayloadSchema = z.object({
  settlement: settlementSchema,
  botPlayers: botPlayersSchema
});

/** 流局 payload:api 据此关闭 Round(记 abortReason/failedPlayerId)并写零分 RoundPlayer 行保留模型身份。 */
export const roundAbortedPayloadSchema = z.object({
  reason: z.string().min(1),
  /** 技术负归属:导致流局的 bot;为 null 表示非决策失败导致(预留)。 */
  failedPlayerId: z.string().min(1).nullable(),
  players: z
    .array(
      z.object({
        playerId: z.string().min(1),
        seat: z.union([z.literal(0), z.literal(1), z.literal(2)])
      })
    )
    .length(3),
  botPlayers: botPlayersSchema
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
  seq: z.number().int().positive(),
  type: roundActionTypeSchema,
  playerId: z.string().min(1).nullable(),
  playerKind: z.enum(["human", "bot"]).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime()
});

export const roundHistoryPlayerSchema = z.object({
  playerId: z.string().min(1),
  nickname: z.string().min(1).optional(),
  /** LLM bot 的模型身份（真人与规则 bot 缺省）：复盘/公开对局列表据此展示选手档案 */
  model: botModelRefSchema.optional(),
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
  actions: z.array(roundHistoryActionSchema),
  /** 当前查看者自己的初始牌；旧对局或缺失时为空，绝不包含其他玩家手牌。 */
  viewerInitialHand: z.array(cardSchema).default([]),
  /** 明牌复盘：三家完整初始手牌。仅公开回放（全 bot 局）下发，真人局恒为空。 */
  revealedHands: z
    .array(
      z.object({
        playerId: z.string().min(1),
        cards: z.array(cardSchema)
      })
    )
    .default([])
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

/**
 * bot 成功决策的留证摘要:game-server 写进 landlord_bid/landlord_robbed/cards_played/player_passed
 * 的动作 payload(aiTrace 键),复盘读侧按此解析展示逐手 reasoning。
 */
export const aiTracePayloadSchema = z.object({
  model: z.string().min(1),
  latencyMs: z.number().int().min(0),
  reasoningText: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional()
});

/**
 * 模型排行榜条目:按 (provider, model) 聚合全部已结束对局。
 * games/wins 只计有结算的局;技术负(流局归属)单列,不算 games。
 */
export const leaderboardEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  games: z.number().int().min(0),
  wins: z.number().int().min(0),
  landlordGames: z.number().int().min(0),
  landlordWins: z.number().int().min(0),
  farmerGames: z.number().int().min(0),
  farmerWins: z.number().int().min(0),
  /** 累计得分(zero-sum 结算分,含倍数),体现赢的含金量 */
  totalScore: z.number().int(),
  /** 技术负:LLM 决策耗尽重试导致的流局次数 */
  technicalLosses: z.number().int().min(0)
});

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema)
});

export type CardDto = z.infer<typeof cardSchema>;
export type BotModelRefDto = z.infer<typeof botModelRefSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameSnapshotDto = z.infer<typeof gameSnapshotSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type UpdateRoomStatusRequest = z.infer<typeof updateRoomStatusRequestSchema>;
export type RoomClaimRequest = z.infer<typeof roomClaimRequestSchema>;
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
export type RoomMode = z.infer<typeof roomModeSchema>;
export type SettlementDto = z.infer<typeof settlementSchema>;
export type RoundHistoryActionDto = z.infer<typeof roundHistoryActionSchema>;
export type RoundHistoryPlayerDto = z.infer<typeof roundHistoryPlayerSchema>;
export type RoundHistoryItemDto = z.infer<typeof roundHistoryItemSchema>;
export type RoundHistoryResponse = z.infer<typeof roundHistoryResponseSchema>;
export type RoundReplayDto = z.infer<typeof roundReplaySchema>;
export type RoundReplayResponse = z.infer<typeof roundReplayResponseSchema>;
export type CoinLedgerItemDto = z.infer<typeof coinLedgerItemSchema>;
export type CoinLedgerResponse = z.infer<typeof coinLedgerResponseSchema>;
export type LeaderboardEntryDto = z.infer<typeof leaderboardEntrySchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type AiTracePayloadDto = z.infer<typeof aiTracePayloadSchema>;
