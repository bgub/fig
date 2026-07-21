import { describe, expect, it } from "vitest";
import {
  clearQueueLanes,
  cloneQueue,
  HookUpdate,
  mergeQueues,
} from "./hook-queue.ts";
import { DefaultLane, NoLane, SyncLane } from "./lanes.ts";

function update(action: number, lane: number): HookUpdate<number> {
  return new HookUpdate(action, lane);
}

function actions(queue: HookUpdate<number>): number[] {
  const values: number[] = [];
  let current = queue.next;
  do {
    if (typeof current.action !== "number") {
      throw new Error("Expected a numeric update.");
    }
    values.push(current.action);
    current = current.next;
  } while (current !== queue.next);
  return values;
}

describe("hook queues", () => {
  it("merges circular queues in dispatch order", () => {
    const first = update(1, SyncLane);
    const second = update(2, DefaultLane);

    const merged = mergeQueues(first, second);

    expect(actions(merged)).toEqual([1, 2]);
  });

  it("clones queue nodes before rebasing", () => {
    const merged = mergeQueues(update(1, SyncLane), update(2, DefaultLane));
    const clone = cloneQueue(merged);

    expect(clone).not.toBeNull();
    expect(clone).not.toBe(merged);
    if (clone === null) throw new Error("Expected a cloned queue.");
    expect(actions(clone)).toEqual([1, 2]);

    clearQueueLanes(clone);
    expect(clone.lane).toBe(NoLane);
    expect(clone.next.lane).toBe(NoLane);
    expect(merged.lane).toBe(DefaultLane);
    expect(merged.next.lane).toBe(SyncLane);
  });
});
