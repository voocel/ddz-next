import type { BotModelRefDto } from "@ddz/protocol";

/**
 * 思考强度档位:reasoning 直播是核心观赏点,默认 medium;关闭最省 token 但面板只剩编号。
 * 与服务端 @ddz/bot-ai 的 ReasoningEffort 取值一致(服务端 parseReasoningEffort 仍是校验权威)。
 */
export type ReasoningEffort = "auto" | "off" | "low" | "medium" | "high";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["auto", "off", "low", "medium", "high"];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/** 一份记住的阵容:席位模型 + 思考强度(API key 始终在服务端,前端永不接触;合法性由服务端注册表收口)。 */
export interface LineupDefault {
  readonly models: readonly BotModelRefDto[];
  readonly reasoningEffort: ReasoningEffort;
}

/** challenge = 挑战桌 2 席对手;arena = 竞技场 3 席选手。 */
export type LineupKind = "challenge" | "arena";

export const LINEUP_SEATS: Record<LineupKind, number> = { challenge: 2, arena: 3 };

const STORAGE_KEY = "ddz-lineups";

type StoredLineups = Partial<Record<LineupKind, LineupDefault>>;

/** 解析存储原文:空/损坏/形状不符/席数不符都安全回退(纯函数,便于单测)。 */
export function parseLineupDefaults(raw: string | null): StoredLineups {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: Partial<Record<LineupKind, LineupDefault>> = {};
    for (const kind of ["challenge", "arena"] as const) {
      const entry = readLineup(parsed[kind], LINEUP_SEATS[kind]);
      if (entry) {
        result[kind] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readLineup(value: unknown, seats: number): LineupDefault | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { models, reasoningEffort } = value as { models?: unknown; reasoningEffort?: unknown };
  if (!Array.isArray(models) || models.length !== seats) {
    return null;
  }
  const parsed = models.filter(
    (seat): seat is BotModelRefDto =>
      Boolean(seat) &&
      typeof seat === "object" &&
      typeof (seat as { provider?: unknown }).provider === "string" &&
      typeof (seat as { model?: unknown }).model === "string"
  );
  if (parsed.length !== seats) {
    return null;
  }
  const effort =
    typeof reasoningEffort === "string" && (REASONING_EFFORTS as readonly string[]).includes(reasoningEffort)
      ? (reasoningEffort as ReasoningEffort)
      : DEFAULT_REASONING_EFFORT;
  return { models: parsed, reasoningEffort: effort };
}

/** 读取上次使用的阵容;无记录/不可用返回 null(调用方回退默认选择)。 */
export function loadLineupDefault(kind: LineupKind): LineupDefault | null {
  try {
    return parseLineupDefaults(window.localStorage.getItem(STORAGE_KEY))[kind] ?? null;
  } catch {
    return null;
  }
}

/** 记住本次阵容;存储不可用时静默忽略(仅本次会话生效)。 */
export function saveLineupDefault(kind: LineupKind, value: LineupDefault): void {
  try {
    const current = parseLineupDefaults(window.localStorage.getItem(STORAGE_KEY));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, [kind]: value }));
  } catch {
    // ignore
  }
}
