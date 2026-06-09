import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "../../src/rooms/serialTaskQueue";

describe("SerialTaskQueue", () => {
  it("runs async tasks one at a time in enqueue order", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirstTask: (() => void) | null = null;

    const first = queue.enqueue(
      () =>
        new Promise<string>((resolve) => {
          events.push("first:start");
          releaseFirstTask = () => {
            events.push("first:end");
            resolve("first");
          };
        })
    );
    const second = queue.enqueue(async () => {
      events.push("second");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirstTask?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a task rejects", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];

    const failed = queue.enqueue(async () => {
      events.push("failed");
      throw new Error("boom");
    });
    const next = queue.enqueue(async () => {
      events.push("next");
      return "ok";
    });

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
    expect(events).toEqual(["failed", "next"]);
  });
});
