import { Client, type Room } from "@colyseus/sdk";
import type { CardId } from "@ddz/domain";
import {
  type CardDto,
  coinLedgerResponseSchema,
  gameEventSchema,
  loginResponseSchema,
  roomResponseSchema,
  roundHistoryResponseSchema,
  roundReplayResponseSchema,
  type GameEvent,
  type GameSnapshotDto,
  type LoginResponse,
  type RoomDto
} from "@ddz/protocol";

const apiEndpoint = readUrlEnv("SMOKE_API_ENDPOINT", process.env.API_ENDPOINT ?? "http://localhost:3000");
const gameEndpoint = readUrlEnv("SMOKE_GAME_ENDPOINT", process.env.GAME_ENDPOINT ?? "http://localhost:2567");
const runId = `${Date.now()}-${process.pid}`;
const username = `smoke_${runId}`;
const password = "smoke-secret-123";
const nickname = "Smoke";

async function main(): Promise<void> {
  await assertApiHealthy();
  const session = await register();
  const room = await createRoom(session.accessToken);
  const game = await joinGame(session, room);
  const events: GameEvent[] = [];
  let hand: CardDto[] = [];
  let latestSnapshot: GameSnapshotDto | null = null;
  let roomFailure: Error | null = null;

  game.onMessage("event", (payload: unknown) => {
    const parsed = gameEventSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`Invalid game event: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    events.push(parsed.data);
    if ("snapshot" in parsed.data) {
      latestSnapshot = parsed.data.snapshot;
    }
    if ("hand" in parsed.data) {
      hand = parsed.data.hand;
    }
    if (parsed.data.type === "room_failed") {
      roomFailure = new Error(`Game room failed: ${parsed.data.reason}`);
    }
  });
  game.onError((code, message) => {
    roomFailure = new Error(`Game room error ${code}: ${message}`);
  });
  game.onLeave((code) => {
    if (latestSnapshot?.phase !== "settled") {
      roomFailure = new Error(`Game room closed before settlement: ${code}`);
    }
  });

  try {
    await waitForSnapshot(() => latestSnapshot, () => roomFailure, "initial snapshot");
    game.send("command", { type: "ready" });
    await playUntilSettled(game, () => latestSnapshot, () => roomFailure, () => hand, session.user.id);
  } finally {
    await game.leave();
  }

  const history = await getAuthed("/me/rounds", session.accessToken, roundHistoryResponseSchema);
  const completedRound = history.rounds.find((round) => round.endedAt !== null && round.players.some((player) => player.playerId === session.user.id));
  if (!completedRound) {
    throw new Error("Smoke round was not written to round history.");
  }

  const replay = await getAuthed(`/me/rounds/${encodeURIComponent(completedRound.id)}`, session.accessToken, roundReplayResponseSchema);
  if (!replay.round.actions.some((action) => action.type === "round_settled")) {
    throw new Error("Smoke replay does not contain round_settled.");
  }
  const actionSeqs = replay.round.actions.map((action) => action.seq);
  if (!actionSeqs.every((seq, index) => seq === index + 1)) {
    throw new Error(`Smoke replay action sequence is not contiguous: ${actionSeqs.join(",")}`);
  }

  const ledgers = await getAuthed("/me/coin-ledgers", session.accessToken, coinLedgerResponseSchema);
  if (!ledgers.ledgers.some((ledger) => ledger.roundId === completedRound.id)) {
    throw new Error("Smoke coin ledger was not written.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: room.code,
        roundId: completedRound.id,
        events: events.length,
        actions: replay.round.actions.length,
        ledgers: ledgers.ledgers.length
      },
      null,
      2
    )
  );
}

async function playUntilSettled(
  room: Room,
  readSnapshot: () => GameSnapshotDto | null,
  readFailure: () => Error | null,
  readHand: () => readonly CardDto[],
  localPlayerId: string
): Promise<void> {
  const deadline = Date.now() + readPositiveIntegerEnv("SMOKE_TIMEOUT_MS", 30_000);
  const handledStates = new Set<string>();

  while (Date.now() < deadline) {
    const snapshot = await waitForSnapshot(readSnapshot, readFailure, "game progress", 2_000);

    if (snapshot.phase === "settled") {
      return;
    }

    if (snapshot.currentPlayerId !== localPlayerId && (snapshot.phase === "bidding" || snapshot.phase === "robbing" || snapshot.phase === "playing")) {
      await delay(80);
      continue;
    }

    const stateKey = [
      snapshot.phase,
      snapshot.currentPlayerId ?? "-",
      snapshot.lastPlay?.playerId ?? "-",
      snapshot.lastPlay?.cards.map((card) => card.id).join(",") ?? "-",
      snapshot.passCount,
      snapshot.players.find((player) => player.id === localPlayerId)?.handCount ?? "-"
    ].join("|");
    if (handledStates.has(stateKey)) {
      await delay(80);
      continue;
    }
    handledStates.add(stateKey);

    switch (snapshot.phase) {
      case "bidding":
        room.send("command", { type: "bid_landlord", called: true });
        break;
      case "robbing":
        room.send("command", { type: "rob_landlord", robbed: true });
        break;
      case "playing":
        playCardsOrPass(room, snapshot, readHand(), localPlayerId);
        break;
      case "waiting":
      case "ready":
        room.send("command", { type: "ready" });
        break;
    }

    await delay(120);
  }

  const snapshot = readSnapshot();
  throw new Error(`Smoke game did not settle before timeout. ${snapshot ? formatSnapshotSummary(snapshot) : "No snapshot was received."}`);
}

function playCardsOrPass(room: Room, snapshot: GameSnapshotDto, hand: readonly CardDto[], localPlayerId: string): void {
  const localPlayer = snapshot.players.find((player) => player.id === localPlayerId);
  if (!localPlayer) {
    throw new Error("Smoke local player is missing from snapshot.");
  }

  if (snapshot.lastPlay && snapshot.lastPlay.playerId !== localPlayer.id) {
    room.send("command", { type: "pass" });
    return;
  }

  const firstCard = hand[0];
  if (!firstCard) {
    throw new Error("Smoke local player has no tracked hand cards.");
  }

  room.send("command", {
    type: "play_cards",
    cards: [firstCard.id as CardId]
  });
}

async function assertApiHealthy(): Promise<void> {
  const body = await requestJson("/health", { method: "GET" });
  if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
    throw new Error("API health endpoint did not return ok=true.");
  }
}

async function register(): Promise<LoginResponse> {
  const body = await requestJson("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      nickname,
      password
    })
  });
  return parseBody(body, loginResponseSchema, "register response");
}

async function createRoom(accessToken: string): Promise<RoomDto> {
  const body = await requestJson("/rooms", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({})
  });
  return parseBody(body, roomResponseSchema, "create room response").room;
}

async function joinGame(session: LoginResponse, room: RoomDto): Promise<Room> {
  const client = new Client(gameEndpoint);
  return client.joinOrCreate("ddz", {
    accessToken: session.accessToken,
    roomCode: room.code,
    quickStart: true,
    botDecisionMode: "rule",
    botMoveDelayMs: 50,
    turnTimeoutMs: 3_000
  });
}

async function getAuthed<T>(path: string, accessToken: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { message: string }[] } } }): Promise<T> {
  const body = await requestJson(path, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  return parseBody(body, schema, path);
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  const url = new URL(path, apiEndpoint);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers
      }
    });
  } catch (error) {
    throw new Error(`Cannot reach API endpoint ${url.toString()}: ${formatUnknownError(error)}`, {
      cause: error
    });
  }

  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(body));
  }
  return body;
}

function parseBody<T>(
  body: unknown,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { message: string }[] } } },
  label: string
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}

async function waitForSnapshot(
  readSnapshot: () => GameSnapshotDto | null,
  readFailure: () => Error | null,
  label: string,
  timeoutMs = 5_000
): Promise<GameSnapshotDto> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = readFailure();
    if (failure) {
      throw failure;
    }

    const snapshot = readSnapshot();
    if (snapshot) {
      return snapshot;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function readUrlEnv(name: string, value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return "Smoke request failed.";
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSnapshotSummary(snapshot: GameSnapshotDto): string {
  const players = snapshot.players
    .map((player) => `${player.id}:${player.kind}:seat${player.seat}:hand${player.handCount}:connected${player.connected}`)
    .join(", ");
  const lastPlay = snapshot.lastPlay
    ? `${snapshot.lastPlay.playerId} ${snapshot.lastPlay.combination.kind} ${snapshot.lastPlay.cards.map((card) => card.id).join(",")}`
    : "none";

  return `Last snapshot phase=${snapshot.phase}, currentPlayerId=${snapshot.currentPlayerId ?? "none"}, landlordId=${
    snapshot.landlordId ?? "none"
  }, passCount=${snapshot.passCount}, lastPlay=${lastPlay}, players=[${players}].`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

await main();
