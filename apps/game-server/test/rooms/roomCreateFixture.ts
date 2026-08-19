import { vi } from "vitest";
import type { InternalRoomStateResponse, RoomDto, RoomStatus } from "@ddz/protocol";
import type { RecordGameActionsInput } from "../../src/api/gameActionClient";
import { DdzRoom } from "../../src/rooms/DdzRoom";
import type { GameTable } from "@ddz/domain";

export type RoomCreateOptions = Parameters<DdzRoom["onCreate"]>[0];
export type RoomCreateOptionOverrides = Partial<Omit<RoomCreateOptions, "roomStatusClient" | "gameActionClient" | "roomCode">>;
export type InternalRoomLiveState = NonNullable<InternalRoomStateResponse["state"]>;

export function stateResponse(code: string, status: RoomStatus, state: InternalRoomLiveState | null): InternalRoomStateResponse {
  return {
    room: {
      id: `room-${code}`,
      code,
      status,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies RoomDto,
    state
  };
}

export interface RoomFixture {
  readonly room: DdzRoom;
  readonly options: RoomCreateOptions;
  readonly broadcast: ReturnType<typeof vi.fn>;
  readonly clock: { setTimeout: ReturnType<typeof vi.fn>; setInterval: ReturnType<typeof vi.fn> };
  readonly gameActions: RecordGameActionsInput[];
  /** 房间上报过的状态序列（updateRoomStatus 调用记录） */
  readonly statusUpdates: string[];
  readonly claims: string[];
  /** 让下一次 updateRoomStatus 挂起到给定 promise 解决，用于验证 dispose 期间的竞态 */
  gateNextStatusUpdate(gate: Promise<void>): void;
  internals(): Record<string, never> & {
    botBrain: unknown;
    table: GameTable;
    botIds: string[];
    clientPlayers: Map<string, string>;
    nicknames: Map<string, string>;
    tasks: { enqueue(task: () => Promise<void>): Promise<void> };
  };
  bindHumanClient(playerId: string): { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> };
  handleCommand(client: { readonly sessionId: string; readonly send: ReturnType<typeof vi.fn> }, payload: unknown): Promise<void>;
  flushTasks(): Promise<void>;
}

let fixtureSequence = 0;

/** 裸实例 + 最小 Colyseus 桩，避免拉起完整运行时（与 ddzRoomFailRoom.test.ts 同风格） */
export function createRoomFixture(
  code: string,
  response: InternalRoomStateResponse,
  optionOverrides: RoomCreateOptionOverrides = {}
): RoomFixture {
  const room = new DdzRoom();
  const internals = room as unknown as Record<string, unknown>;
  const broadcast = vi.fn();
  const clock = {
    setTimeout: vi.fn(() => ({ clear: vi.fn() })),
    setInterval: vi.fn(() => ({ clear: vi.fn() }))
  };
  const gameActions: RecordGameActionsInput[] = [];
  const statusUpdates: string[] = [];
  const claims: string[] = [];
  let statusGate: Promise<void> | null = null;

  fixtureSequence += 1;
  Object.defineProperty(room, "roomId", { value: `colyseus-${fixtureSequence}`, configurable: true });
  Object.defineProperty(room, "clock", { value: clock, configurable: true });
  Object.defineProperty(room, "clients", { value: [], configurable: true });
  internals.broadcast = broadcast;
  internals.setMetadata = vi.fn();
  internals.setPrivate = vi.fn();
  internals.onMessage = vi.fn();

  const options: RoomCreateOptions = {
    roomCode: code,
    ...optionOverrides,
    roomStatusClient: {
      async getRoomState(): Promise<InternalRoomStateResponse> {
        return response;
      },
      async claimRoom(_code: string, ownerId: string): Promise<void> {
        claims.push(`claim:${ownerId}`);
      },
      async refreshRoomClaim(_code: string, ownerId: string): Promise<void> {
        claims.push(`refresh:${ownerId}`);
      },
      async releaseRoomClaim(_code: string, ownerId: string): Promise<void> {
        claims.push(`release:${ownerId}`);
      },
      async updateRoomStatus(_code: string, status: string, ownerId: string): Promise<void> {
        if (statusGate) {
          const gate = statusGate;
          statusGate = null;
          await gate;
        }
        statusUpdates.push(`${status}:${ownerId}`);
      }
    },
    gameActionClient: {
      async recordGameActions(input: RecordGameActionsInput): Promise<void> {
        gameActions.push(input);
      }
    }
  };

  return {
    room,
    options,
    broadcast,
    clock,
    gameActions,
    statusUpdates,
    claims,
    gateNextStatusUpdate: (gate: Promise<void>) => {
      statusGate = gate;
    },
    internals: () => internals as ReturnType<RoomFixture["internals"]>,
    bindHumanClient: (playerId: string) => {
      const client = { sessionId: `session-${playerId}`, send: vi.fn() };
      (internals.table as GameTable).addPlayer(playerId);
      (internals.clientPlayers as Map<string, string>).set(client.sessionId, playerId);
      return client;
    },
    handleCommand: (client, payload) =>
      (room as unknown as { handleCommand(client: unknown, payload: unknown): Promise<void> }).handleCommand(client, payload),
    flushTasks: async () => {
      await (internals.tasks as { enqueue(task: () => Promise<void>): Promise<void> }).enqueue(async () => {});
    }
  };
}

type RuntimeEnv = Record<string, string | undefined>;

export function runtimeEnv(): RuntimeEnv {
  const runtime = globalThis as typeof globalThis & { process?: { env?: RuntimeEnv } };
  if (!runtime.process?.env) {
    throw new Error("process.env is required for DdzRoom env tests.");
  }
  return runtime.process.env;
}

export function setEnv(name: string, value: string): void {
  runtimeEnv()[name] = value;
}

export function restoreEnv(name: string, value: string | undefined): void {
  const env = runtimeEnv();
  if (value === undefined) {
    delete env[name];
    return;
  }
  env[name] = value;
}
