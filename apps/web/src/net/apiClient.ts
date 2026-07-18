import {
  coinLedgerResponseSchema,
  leaderboardResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  loginResponseSchema,
  roundHistoryResponseSchema,
  roundReplayResponseSchema,
  type CoinLedgerResponse,
  type LeaderboardResponse,
  type LoginRequest,
  type LoginResponse,
  type RoundHistoryResponse,
  type RoundReplayResponse,
  type RoomListResponse,
  type RoomMode,
  type RoomResponse,
  type RegisterRequest
} from "@ddz/protocol";

export interface ApiClientOptions {
  readonly endpoint: string;
  /** 请求返回 401 时回调（用于自动登出） */
  readonly onUnauthorized?: () => void;
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
      return requestJson(options, "/rooms", {
        method: "GET"
      }).then((body) => parseRoomList(body));
    },
    listArenaRooms(): Promise<RoomListResponse> {
      return requestJson(options, "/arena/rooms", {
        method: "GET"
      }).then((body) => parseRoomList(body));
    },
    getRoomByCode(code: string): Promise<RoomResponse> {
      return requestJson(options, `/rooms/${encodeURIComponent(code)}`, {
        method: "GET"
      }).then((body) => parseRoomResponse(body));
    },
    createRoom(accessToken: string, mode: RoomMode = "standard"): Promise<RoomResponse> {
      return requestJson(options, "/rooms", {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify(mode === "standard" ? {} : { mode })
      }).then((body) => parseRoomResponse(body));
    },
    listRoundHistory(accessToken: string): Promise<RoundHistoryResponse> {
      return requestJson(options, "/me/rounds", {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseRoundHistory(body));
    },
    getRoundReplay(accessToken: string, roundId: string): Promise<RoundReplayResponse> {
      return requestJson(options, `/me/rounds/${encodeURIComponent(roundId)}`, {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseRoundReplay(body));
    },
    /** 公开复盘（仅全 bot 局，明牌）：无需登录，供分享链接与竞技场回放入口 */
    getPublicRoundReplay(roundId: string): Promise<RoundReplayResponse> {
      return requestJson(options, `/replays/${encodeURIComponent(roundId)}`, {
        method: "GET"
      }).then((body) => parseRoundReplay(body));
    },
    listRecentReplays(): Promise<RoundHistoryResponse> {
      return requestJson(options, "/replays/recent", {
        method: "GET"
      }).then((body) => parseRoundHistory(body));
    },
    listCoinLedgers(accessToken: string): Promise<CoinLedgerResponse> {
      return requestJson(options, "/me/coin-ledgers", {
        method: "GET",
        headers: authHeaders(accessToken)
      }).then((body) => parseCoinLedgers(body));
    },
    getLeaderboard(): Promise<LeaderboardResponse> {
      return requestJson(options, "/leaderboard", {
        method: "GET"
      }).then((body) => parseLeaderboard(body));
    }
  };
}

async function postAuth(endpoint: string, path: string, payload: unknown): Promise<LoginResponse> {
  // 认证接口的 401 表示账号密码错误，不走自动登出回调
  const body = await requestJson({ endpoint }, path, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const parsed = loginResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid authentication response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

async function requestJson(options: ApiClientOptions, path: string, init: RequestInit): Promise<unknown> {
  const headers = {
    ...init.headers,
    ...(init.body === undefined ? {} : { "content-type": "application/json" })
  };
  const response = await fetch(new URL(path, options.endpoint), {
    ...init,
    headers
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    if (response.status === 401) {
      options.onUnauthorized?.();
    }
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

function parseLeaderboard(body: unknown): LeaderboardResponse {
  const parsed = leaderboardResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid leaderboard response: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
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
  if (!body || typeof body !== "object") {
    return "请求失败，请稍后重试。";
  }

  const issueMessage = readFirstIssueMessage(body);
  if (issueMessage) {
    return issueMessage;
  }

  if ("message" in body && typeof body.message === "string") {
    return localizeApiMessage(body.message);
  }

  return "请求失败，请稍后重试。";
}

function localizeApiMessage(message: string): string {
  switch (message) {
    case "Invalid username or password.":
      return "用户名或密码错误。";
    case "Username already exists.":
      return "用户名已存在。";
    case "Username must be 3-32 letters, numbers, underscores, or hyphens.":
      return "用户名只能包含 3-32 位字母、数字、下划线或短横线。";
    case "Invalid login request.":
      return "请检查用户名和密码。";
    case "Invalid register request.":
      return "请检查注册信息。";
    default:
      return message;
  }
}

function readFirstIssueMessage(body: object): string | null {
  if (!("issues" in body) || !Array.isArray(body.issues)) {
    return null;
  }

  for (const issue of body.issues) {
    const message = localizeIssue(issue);
    if (message) {
      return message;
    }
  }

  return null;
}

function localizeIssue(issue: unknown): string | null {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const field = readIssueField(issue);
  const code = readStringProperty(issue, "code");
  const minimum = readNumberProperty(issue, "minimum");
  const maximum = readNumberProperty(issue, "maximum");
  const label = field ? FIELD_LABELS[field] : null;

  if (!label) {
    return null;
  }

  if (code === "too_small") {
    if (field === "nickname") {
      return "昵称不能为空。";
    }
    if (typeof minimum === "number") {
      return `${label}至少 ${minimum} 位。`;
    }
  }

  if (code === "too_big" && typeof maximum === "number") {
    return `${label}不能超过 ${maximum} 位。`;
  }

  if (code === "invalid_type") {
    return `${label}不能为空。`;
  }

  return `${label}格式不正确。`;
}

const FIELD_LABELS = {
  username: "用户名",
  nickname: "昵称",
  password: "密码"
} as const;

type KnownField = keyof typeof FIELD_LABELS;

function readIssueField(issue: object): KnownField | null {
  if (!("path" in issue) || !Array.isArray(issue.path)) {
    return null;
  }

  const [field] = issue.path;
  return typeof field === "string" && field in FIELD_LABELS ? (field as KnownField) : null;
}

function readStringProperty(value: object, key: string): string | null {
  return key in value && typeof value[key as keyof typeof value] === "string" ? value[key as keyof typeof value] : null;
}

function readNumberProperty(value: object, key: string): number | null {
  return key in value && typeof value[key as keyof typeof value] === "number" ? value[key as keyof typeof value] : null;
}
