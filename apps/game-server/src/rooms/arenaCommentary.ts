import type { ArenaCommentator, ArenaCommentaryContext, BotProviderRegistry, ModelRef } from "@ddz/bot-ai";

/** 解说触发场景白名单;opening/settlement 是叙事骨架不受最小间隔节流(仍受单 in-flight 限制)。 */
export type ArenaCommentaryTag = "opening" | "round_start" | "landlord" | "bomb" | "endgame" | "settlement";

const ALWAYS_FIRE_TAGS: ReadonlySet<ArenaCommentaryTag> = new Set(["opening", "settlement"]);
const DEFAULT_MIN_INTERVAL_MS = 8000;

export interface ArenaCommentaryDirectorOptions {
  readonly commentator: ArenaCommentator;
  /** 解说生成成功后的广播出口(fire-and-forget,不持有房间串行锁)。 */
  readonly broadcast: (text: string, tag: ArenaCommentaryTag) => void;
  readonly minIntervalMs?: number;
  /** 可注入时钟便于测试;默认 Date.now。 */
  readonly now?: () => number;
}

/**
 * 竞技场解说导演:按关键事件触发 + 节流(最小间隔、同时最多 1 个 in-flight、跳过不排队)。
 * 纯装饰层:生成失败静默,绝不影响对局推进。
 */
export class ArenaCommentaryDirector {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private inFlight = false;
  private lastFiredAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ArenaCommentaryDirectorOptions) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /** 触发一次解说;正被节流/已有 in-flight 时直接跳过(不排队,解说要跟得上牌局节奏)。 */
  notify(tag: ArenaCommentaryTag, context: ArenaCommentaryContext): void {
    if (this.inFlight) {
      return;
    }
    const now = this.now();
    if (!ALWAYS_FIRE_TAGS.has(tag) && now - this.lastFiredAt < this.minIntervalMs) {
      return;
    }

    this.inFlight = true;
    this.lastFiredAt = now;
    void this.options.commentator
      .comment(context)
      .then((text) => {
        if (text) {
          this.options.broadcast(text, tag);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = false;
      });
  }
}

/**
 * 解析竞技场解说模型:ARENA_COMMENTARY_MODEL="provider/model"(建议 haiku 级快模型),
 * 缺省用注册表默认;ARENA_COMMENTARY_ENABLED=false 显式关闭。返回 null 表示不启用。
 */
export function arenaCommentaryModelFromEnv(
  registry: BotProviderRegistry,
  env: NodeJS.ProcessEnv = process.env
): ModelRef | null {
  if (env.ARENA_COMMENTARY_ENABLED === "false") {
    return null;
  }
  const raw = env.ARENA_COMMENTARY_MODEL?.trim();
  if (!raw) {
    return registry.default;
  }
  const separator = raw.indexOf("/");
  if (separator <= 0 || separator === raw.length - 1) {
    throw new Error(`ARENA_COMMENTARY_MODEL 必须是 "provider/model" 格式,当前为 "${raw}"。`);
  }
  return { provider: raw.slice(0, separator), model: raw.slice(separator + 1) };
}
