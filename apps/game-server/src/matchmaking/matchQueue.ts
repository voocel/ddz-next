export interface MatchQueueEntry {
  readonly playerId: string;
  readonly sessionId: string;
  readonly enqueuedAt: number;
}

/**
 * 匹配队列接口。所有方法均为异步：当前为单实例内存实现，
 * 将来横向扩展时可替换为 Redis 实现而无需改动调用方。
 */
export interface MatchQueue {
  /** 入队（同一 playerId 重复入队时旧条目被替换，保留原排队时间） */
  enqueue(entry: MatchQueueEntry): Promise<void>;
  removeBySession(sessionId: string): Promise<void>;
  /** 取出队首 count 个条目（原子移除） */
  take(count: number): Promise<MatchQueueEntry[]>;
  /** 撮合失败时把条目放回队首，保持原有顺序 */
  requeueFront(entries: readonly MatchQueueEntry[]): Promise<void>;
  size(): Promise<number>;
  /** 队首等待时长（毫秒）；空队列返回 null */
  oldestWaitMs(now: number): Promise<number | null>;
  /** sessionId → 1-based 队列位置，用于排队状态广播 */
  positions(): Promise<ReadonlyMap<string, number>>;
}

export class InMemoryMatchQueue implements MatchQueue {
  private entries: MatchQueueEntry[] = [];

  async enqueue(entry: MatchQueueEntry): Promise<void> {
    const existing = this.entries.find((item) => item.playerId === entry.playerId);
    // 同玩家重连/双开：替换会话但不重置排队时间，避免反复重排插队或吃亏
    this.entries = this.entries.filter((item) => item.playerId !== entry.playerId);
    this.entries.push(existing ? { ...entry, enqueuedAt: existing.enqueuedAt } : entry);
    this.entries.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }

  async removeBySession(sessionId: string): Promise<void> {
    this.entries = this.entries.filter((item) => item.sessionId !== sessionId);
  }

  async take(count: number): Promise<MatchQueueEntry[]> {
    return this.entries.splice(0, count);
  }

  async requeueFront(entries: readonly MatchQueueEntry[]): Promise<void> {
    this.entries = [...entries, ...this.entries];
  }

  async size(): Promise<number> {
    return this.entries.length;
  }

  async oldestWaitMs(now: number): Promise<number | null> {
    const head = this.entries[0];
    return head ? Math.max(0, now - head.enqueuedAt) : null;
  }

  async positions(): Promise<ReadonlyMap<string, number>> {
    return new Map(this.entries.map((item, index) => [item.sessionId, index + 1]));
  }
}

/** 撮合决策：返回本轮应取出的人数（0 表示不撮合）。3 人立即开局；队首超时则补 bot 开局。 */
export function planMatchSize(queueSize: number, oldestWaitMs: number | null, timeoutMs: number): number {
  if (queueSize >= 3) {
    return 3;
  }
  if (queueSize > 0 && oldestWaitMs !== null && oldestWaitMs >= timeoutMs) {
    return queueSize;
  }
  return 0;
}
