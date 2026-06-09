import {
  coinLedgerResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  loginResponseSchema,
  roundHistoryResponseSchema,
  roundReplayResponseSchema,
  type CoinLedgerResponse,
  type LoginRequest,
  type LoginResponse,
  type RoundHistoryResponse,
  type RoundReplayResponse,
  type RoomListResponse,
  type RoomResponse,
  type RegisterRequest
} from "@ddz/protocol";

export interface ApiClientOptions {
  readonly endpoint: string;
}

export function createApiClient(options: ApiClientOptions) {
  return {
    login(input: LoginRequest): Promise<LoginResponse> {
      return postAuth(options.endpoint, "/auth/login", input);
    },
    register(input: RegisterRequest): Promise<LoginResponse> {
      return postAuth(options.endpoint, "/auth/register", input);
    },
    listRooms(): Promise<RoomListResponse> {
      return requestJson(options.endpoint, "/rooms", {
        method: "GET"
      }).then((body) => parseRoomList(body));
    },
    createRoom(accessToken: string): Promise<RoomResponse> {
      return requestJson(options.endpoint, "/rooms", {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({})
      }).then((body) => parseRoomResponse(body));
    },
    matchRoom(accessToken: string): Promise<RoomResponse> {
      return requestJson(options.endpoint, "/rooms/match", {
        method: "POST",
        headers: authHeaders(accessToken)
      }).then((body) => parseRoomResponse(body));
    },
    listRoundHistory(accessToken: string): Promise<RoundHistoryResponse> {
      return requestJson(options.endpoint, "/me/rounds", {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseRoundHistory(body));
    },
    getRoundReplay(accessToken: string, roundId: string): Promise<RoundReplayResponse> {
      return requestJson(options.endpoint, `/me/rounds/${encodeURIComponent(roundId)}`, {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseRoundReplay(body));
    },
    listCoinLedgers(accessToken: string): Promise<CoinLedgerResponse> {
      return requestJson(options.endpoint, "/me/coin-ledgers", {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseCoinLedgers(body));
    }
  };
}

async function postAuth(endpoint: string, path: string, payload: unknown): Promise<LoginResponse> {
  const body = await requestJson(endpoint, path, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const parsed = loginResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid authentication response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

async function requestJson(endpoint: string, path: string, init: RequestInit): Promise<unknown> {
  const headers = {
    ...init.headers,
    ...(init.body === undefined ? {} : { "content-type": "application/json" })
  };
  const response = await fetch(new URL(path, endpoint), {
    ...init,
    headers
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(body));
  }
  return body;
}

function parseRoomList(body: unknown): RoomListResponse {
  const parsed = roomListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid room list response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function parseRoomResponse(body: unknown): RoomResponse {
  const parsed = roomResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid room response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function parseRoundHistory(body: unknown): RoundHistoryResponse {
  const parsed = roundHistoryResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid round history response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function parseRoundReplay(body: unknown): RoundReplayResponse {
  const parsed = roundReplayResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid round replay response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function parseCoinLedgers(body: unknown): CoinLedgerResponse {
  const parsed = coinLedgerResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid coin ledger response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }

  return "Authentication request failed.";
}
