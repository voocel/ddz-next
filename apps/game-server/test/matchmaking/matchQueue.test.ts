import { describe, expect, it } from "vitest";
import { InMemoryMatchQueue, planMatchSize } from "../../src/matchmaking/matchQueue.js";

function entry(playerId: string, sessionId: string, enqueuedAt: number) {
  return { playerId, sessionId, enqueuedAt };
}

describe("InMemoryMatchQueue", () => {
  it("keeps FIFO order and takes from the front", async () => {
    const queue = new InMemoryMatchQueue();
    await queue.enqueue(entry("p1", "s1", 100));
    await queue.enqueue(entry("p2", "s2", 200));
    await queue.enqueue(entry("p3", "s3", 300));

    const taken = await queue.take(2);
    expect(taken.map((item) => item.playerId)).toEqual(["p1", "p2"]);
    expect(await queue.size()).toBe(1);
  });

  it("dedupes by player and keeps the original wait time", async () => {
    const queue = new InMemoryMatchQueue();
    await queue.enqueue(entry("p1", "s1", 100));
    await queue.enqueue(entry("p2", "s2", 200));
    // p1 换了会话重新入队：会话更新，但排队时间保留，仍在队首
    await queue.enqueue(entry("p1", "s1b", 999));

    expect(await queue.size()).toBe(2);
    const positions = await queue.positions();
    expect(positions.get("s1b")).toBe(1);
    expect(positions.get("s2")).toBe(2);
    expect(await queue.oldestWaitMs(1100)).toBe(1000);
  });

  it("removes by session and requeues to the front", async () => {
    const queue = new InMemoryMatchQueue();
    await queue.enqueue(entry("p1", "s1", 100));
    await queue.enqueue(entry("p2", "s2", 200));
    await queue.removeBySession("s1");
    expect(await queue.size()).toBe(1);

    const taken = await queue.take(1);
    await queue.enqueue(entry("p3", "s3", 300));
    await queue.requeueFront(taken);
    const positions = await queue.positions();
    expect(positions.get("s2")).toBe(1);
    expect(positions.get("s3")).toBe(2);
  });

  it("returns null wait time for an empty queue", async () => {
    const queue = new InMemoryMatchQueue();
    expect(await queue.oldestWaitMs(123)).toBeNull();
  });
});

describe("planMatchSize", () => {
  it("matches three players immediately", () => {
    expect(planMatchSize(3, 0, 8000)).toBe(3);
    expect(planMatchSize(5, 0, 8000)).toBe(3);
  });

  it("fills with bots after the head times out", () => {
    expect(planMatchSize(1, 8000, 8000)).toBe(1);
    expect(planMatchSize(2, 9000, 8000)).toBe(2);
  });

  it("waits while below capacity and within timeout", () => {
    expect(planMatchSize(0, null, 8000)).toBe(0);
    expect(planMatchSize(1, 0, 8000)).toBe(0);
    expect(planMatchSize(2, 7999, 8000)).toBe(0);
  });
});
