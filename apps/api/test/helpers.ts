import type { RoomActionType, RoomLiveStateEnvelope, RoomStatus, RoundActionType } from "@ddz/protocol";
import { GameActionError } from "../src/actions/errors";
import type { AuthUserRecord, CreateUserInput, UserRepository } from "../src/auth/service";
import type {
  GameActionMutationRecord,
  GameActionRecord,
  GameActionRepository,
  RoomEventInput,
  RoomEventRecord,
  RoundActionInput,
  RoundRecord
} from "../src/actions/service";
import type {
  CoinLedgerRecord,
  HistoryRepository,
  RoundHistoryRecord,
  RoundReplayRecord
} from "../src/history/service";
import type { CreateRoomInput, RoomRecord, RoomRepository } from "../src/rooms/service";
import { assertRoomStatusTransition } from "../src/rooms/status";

export class InMemoryUserRepository implements UserRepository {
  readonly records: AuthUserRecord[] = [];

  async findByUsername(username: string): Promise<AuthUserRecord | null> {
    return this.records.find((record) => record.username === username) ?? null;
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRecord> {
    const record = {
      id: `user-${this.records.length + 1}`,
      username: input.username,
      nickname: input.nickname,
      passwordHash: input.passwordHash
    };
    this.records.push(record);
    return record;
  }
}

export class InMemoryRoomRepository implements RoomRepository {
  readonly records: RoomRecord[] = [];
  /** 标记"已被使用"（有事件/对局）的房间码，清扫时跳过 */
  readonly usedCodes = new Set<string>();
  /** 崩溃恢复状态：code → { state, updatedAt } */
  readonly liveStates = new Map<string, { state: unknown; updatedAt: Date }>();
  readonly claims = new Map<string, { ownerId: string; expiresAt: Date; updatedAt: Date }>();

  async listOpenRooms(limit: number): Promise<readonly RoomRecord[]> {
    return this.records
      .filter((room) => room.status === "open")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async findRoomByCode(code: string): Promise<RoomRecord | null> {
    return this.records.find((room) => room.code === code) ?? null;
  }

  async createRoom(input: CreateRoomInput): Promise<RoomRecord> {
    const now = new Date(Date.UTC(2026, 0, this.records.length + 1));
    const room = {
      id: `room-${this.records.length + 1}`,
      code: input.code,
      status: input.status,
      createdAt: now,
      updatedAt: now
    };
    this.records.push(room);
    return room;
  }

  async updateRoomStatusByCode(code: string, status: RoomRecord["status"], ownerId: string): Promise<RoomRecord | null> {
    const index = this.records.findIndex((room) => room.code === code);
    if (index === -1) {
      return null;
    }
    if (this.claims.get(code)?.ownerId !== ownerId) {
      return null;
    }

    const current = this.records[index]!;
    assertRoomStatusTransition(current.status, status);
    const updated = {
      ...current,
      status,
      updatedAt: new Date(current.updatedAt.getTime() + 1000)
    };
    this.records[index] = updated;
    if (status === "closed") {
      this.liveStates.delete(code);
      this.claims.delete(code);
    }
    return updated;
  }

  async claimRoom(code: string, ownerId: string, expiresAt: Date, now: Date): Promise<RoomRecord | null> {
    const room = this.records.find((item) => item.code === code);
    if (!room || room.status === "closed") {
      return null;
    }
    const claim = this.claims.get(code);
    if (claim && claim.ownerId !== ownerId && claim.expiresAt > now) {
      return null;
    }
    this.claims.set(code, { ownerId, expiresAt, updatedAt: now });
    return room;
  }

  async refreshRoomClaim(code: string, ownerId: string, expiresAt: Date): Promise<boolean> {
    const claim = this.claims.get(code);
    if (!claim || claim.ownerId !== ownerId) {
      return false;
    }
    this.claims.set(code, { ownerId, expiresAt, updatedAt: new Date() });
    return true;
  }

  async releaseRoomClaim(code: string, ownerId: string): Promise<void> {
    const claim = this.claims.get(code);
    if (claim?.ownerId === ownerId) {
      this.claims.delete(code);
    }
  }
  async closeStaleOpenRooms(cutoff: Date): Promise<number> {
    let count = 0;
    this.records.forEach((room, index) => {
      if (room.status === "open" && room.updatedAt.getTime() < cutoff.getTime() && !this.usedCodes.has(room.code)) {
        this.records[index] = {
          ...room,
          status: "closed",
          updatedAt: new Date()
        };
        count += 1;
      }
    });
    return count;
  }

  async findLiveStateByCode(code: string): Promise<unknown | null> {
    return this.liveStates.get(code)?.state ?? null;
  }

  async closeOrphanPlayingRooms(cutoff: Date): Promise<number> {
    let count = 0;
    this.records.forEach((room, index) => {
      if (room.status !== "playing" || room.updatedAt.getTime() >= cutoff.getTime()) {
        return;
      }
      const liveState = this.liveStates.get(room.code);
      if (liveState && liveState.updatedAt.getTime() >= cutoff.getTime()) {
        return;
      }
      this.records[index] = {
        ...room,
        status: "closed",
        updatedAt: new Date()
      };
      this.liveStates.delete(room.code);
      this.claims.delete(room.code);
      count += 1;
    });
    return count;
  }
}

export class InMemoryGameActionRepository implements GameActionRepository {
  readonly rooms = new Map<string, string>();
  readonly roomClaims = new Map<string, string>();
  readonly rounds: RoundRecord[] = [];
  readonly roomEvents: RoomEventRecord[] = [];
  readonly actions: GameActionRecord[] = [];
  readonly mutations = new Map<string, GameActionMutationRecord>();
  /** roomId → 最新崩溃恢复状态（与真实仓库的 RoomLiveState upsert 对应） */
  readonly liveStates = new Map<string, unknown>();
  /** 与真实仓库一致：closed 房跳过状态写入（dispose 竞态守卫） */
  readonly closedRoomIds = new Set<string>();
  skippedClosedStateWrites = 0;
  readonly settlements: Array<{
    roundId: string;
    landlordId: string;
    players: Array<{ playerId: string; playerKind: "human" | "bot"; seat: number; scoreDelta: number }>;
  }> = [];
  readonly coinLedgerPlayerIds: string[] = [];

  async findRoomIdByCode(code: string): Promise<string | null> {
    return this.rooms.get(code) ?? null;
  }

  async findOpenRoundByRoomId(roomId: string): Promise<RoundRecord | null> {
    return this.rounds.find((round) => round.roomId === roomId && !round.endedAt) ?? null;
  }

  async findMutation(roomId: string, mutationId: string): Promise<GameActionMutationRecord | null> {
    return this.mutations.get(mutationKey(roomId, mutationId)) ?? null;
  }

  seedRoom(code: string, roomId: string, ownerId = "owner-1"): void {
    this.rooms.set(code, roomId);
    this.roomClaims.set(roomId, ownerId);
  }

  async seedRound(roomId: string): Promise<RoundRecord> {
    const round = {
      id: `round-${this.rounds.length + 1}`,
      roomId,
      endedAt: null
    };
    this.rounds.push(round);
    return round;
  }

  async recordBatch(input: {
    roomId: string;
    ownerId: string;
    mutationId: string;
    actionFingerprint: string;
    roomEvents: readonly RoomEventInput[];
    roundActions: readonly RoundActionInput[];
    status: RoomStatus | null;
    state: RoomLiveStateEnvelope | null;
  }): Promise<GameActionMutationRecord> {
    const existingMutation = await this.findMutation(input.roomId, input.mutationId);
    if (existingMutation) {
      return existingMutation;
    }
    if (this.roomClaims.get(input.roomId) !== input.ownerId) {
      throw new GameActionError("Room claim is not held by this game server.", 409);
    }

    const roomEvents = input.roomEvents.map((event) => this.createRoomEvent(input.roomId, event));
    const actions: GameActionRecord[] = [];
    let round = await this.findOpenRoundByRoomId(input.roomId);

    for (const action of input.roundActions) {
      if (action.type === "round_started") {
        round = await this.seedRound(input.roomId);
      }
      if (!round) {
        throw new Error(`Cannot record ${action.type} without an open round.`);
      }
      actions.push(this.createAction(round.id, action));
      if (action.settlement) {
        // 镜像 Prisma applySettlement 的 endedAt IS NULL 守卫：已结算的 round 不得二次结算（防金币重复入账）
        const persisted = this.rounds.find((item) => item.id === round?.id);
        if (persisted?.endedAt) {
          throw new GameActionError("Round was already settled.", 409);
        }
        this.settlements.push({
          roundId: round.id,
          landlordId: action.settlement.landlordId,
          players: action.settlement.players.map((player) => ({ ...player }))
        });
        this.coinLedgerPlayerIds.push(
          ...action.settlement.players.filter((player) => player.playerKind === "human").map((player) => player.playerId)
        );
        round = {
          ...round,
          endedAt: new Date(Date.UTC(2026, 0, this.actions.length + 1))
        };
        const index = this.rounds.findIndex((item) => item.id === round?.id);
        if (index >= 0) {
          this.rounds[index] = round;
        }
      }
    }

    // 镜像 Prisma 事务语义：动作全部成功后才写状态，closed mutation 不写可恢复状态
    if (input.state && input.status !== "closed" && !this.closedRoomIds.has(input.roomId)) {
      this.liveStates.set(input.roomId, input.state);
    } else if (input.state && input.status === "closed") {
      this.skippedClosedStateWrites += 1;
    }
    if (input.status) {
      if (input.status === "closed") {
        this.closedRoomIds.add(input.roomId);
        this.liveStates.delete(input.roomId);
      }
    }

    const mutation = {
      mutationId: input.mutationId,
      actionFingerprint: input.actionFingerprint,
      roomEventIds: roomEvents.map((event) => event.id),
      actionIds: actions.map((action) => action.id),
      roundId: round?.id ?? null
    };
    this.mutations.set(mutationKey(input.roomId, input.mutationId), mutation);
    return mutation;
  }

  private createRoomEvent(roomId: string, input: RoomEventInput): RoomEventRecord {
    const event = {
      id: `room-event-${this.roomEvents.length + 1}`,
      roomId,
      seq: this.roomEvents.filter((event) => event.roomId === roomId).length + 1,
      playerId: input.playerId,
      playerKind: input.playerKind,
      type: input.type as RoomActionType,
      payload: input.payload,
      createdAt: new Date(Date.UTC(2026, 0, this.roomEvents.length + 1))
    };
    this.roomEvents.push(event);
    return event;
  }

  private createAction(roundId: string, input: RoundActionInput): GameActionRecord {
    const action = {
      id: `action-${this.actions.length + 1}`,
      roundId,
      seq: this.actions.filter((action) => action.roundId === roundId).length + 1,
      playerId: input.playerId,
      playerKind: input.playerKind,
      type: input.type as RoundActionType,
      payload: input.payload,
      createdAt: new Date(Date.UTC(2026, 0, this.actions.length + 1))
    };
    this.actions.push(action);
    return action;
  }
}

export class InMemoryHistoryRepository implements HistoryRepository {
  readonly rounds = new Map<string, readonly RoundHistoryRecord[]>();
  readonly replays = new Map<string, RoundReplayRecord>();
  readonly ledgers = new Map<string, readonly CoinLedgerRecord[]>();

  async listRoundsByUserId(userId: string): Promise<readonly RoundHistoryRecord[]> {
    return this.rounds.get(userId) ?? [];
  }

  async listCoinLedgersByUserId(userId: string): Promise<readonly CoinLedgerRecord[]> {
    return this.ledgers.get(userId) ?? [];
  }

  async findRoundByIdForUser(userId: string, roundId: string): Promise<RoundReplayRecord | null> {
    return this.replays.get(`${userId}:${roundId}`) ?? null;
  }
}

function mutationKey(roomId: string, mutationIdValue: string): string {
  return `${roomId}:${mutationIdValue}`;
}
