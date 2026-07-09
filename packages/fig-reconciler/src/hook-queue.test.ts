import { describe, expect, it } from "vite-plus/test";
import {
  clearQueueLanes,
  cloneQueue,
  type HookUpdate,
  mergeQueues,
} from "./hook-queue.ts";
import { DefaultLane, NoLane, SyncLane } from "./lanes.ts";

function update(action: number, lane: number): HookUpdate<number> {
  const value: HookUpdate<number> = {
    action,
    lane,
    next: null as never,
  };
  value.next = value;
  return value;
}

function actions(queue: HookUpdate<number>): number[] {
  const values: number[] = [];
  let current = queue.next;
  do {
    values.push(current.action as number);
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
    expect(actions(clone as HookUpdate<number>)).toEqual([1, 2]);

    clearQueueLanes(clone as HookUpdate<unknown>);
    expect((clone as HookUpdate<number>).lane).toBe(NoLane);
    expect((clone as HookUpdate<number>).next.lane).toBe(NoLane);
    expect(merged.lane).toBe(DefaultLane);
    expect(merged.next.lane).toBe(SyncLane);
  });
});
