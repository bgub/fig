import { describe, expect, it } from "vitest";
import {
  acknowledgeQueue,
  releaseQueueLanes,
  type HookQueue,
  type HookUpdate,
} from "./hook-queue.ts";
import { DefaultLane, NoLane, SyncLane } from "./lanes.ts";

function queue(pending: HookUpdate<number>[]): HookQueue<number> {
  return { pending, offset: 0, dispatch: null, transitionLanes: NoLane };
}

describe("hook queue read boundaries", () => {
  it("keeps updates appended after the committed read boundary", () => {
    const history = queue([{ action: 1, lane: SyncLane }]);
    const through = history.offset + (history.pending?.length ?? 0);
    (history.pending ??= []).push({ action: 2, lane: SyncLane });
    acknowledgeQueue(history, through);
    expect(history.pending).toEqual([{ action: 2, lane: SyncLane }]);
    expect(history.offset).toBe(1);
  });

  it("keeps absolute read positions valid across multiple commits", () => {
    const history = queue([{ action: 1, lane: SyncLane }]);
    acknowledgeQueue(history, 1);
    (history.pending ??= []).push({ action: 2, lane: DefaultLane });
    const through = history.offset + (history.pending?.length ?? 0);
    (history.pending ??= []).push({ action: 3, lane: SyncLane });
    acknowledgeQueue(history, through);
    acknowledgeQueue(history, 1);
    expect(history.pending).toEqual([{ action: 3, lane: SyncLane }]);
    expect(history.offset).toBe(2);
    acknowledgeQueue(history, 3);
    expect(history.pending).toBeNull();
  });

  it("releases only attempted retry lanes within the observed prefix", () => {
    const skipped = { action: 1, lane: DefaultLane };
    const attempted = { action: 2, lane: SyncLane };
    const history = queue([skipped, attempted]);
    const through = history.pending?.length ?? 0;
    (history.pending ??= []).push({ action: 3, lane: SyncLane });
    releaseQueueLanes(history, through, SyncLane);
    expect(history.pending).toEqual([
      skipped,
      { action: 2, lane: NoLane },
      { action: 3, lane: SyncLane },
    ]);
    // Other candidates may still reference the original update records.
    expect(attempted.lane).toBe(SyncLane);
  });

  it("releases a retained prefix after an earlier commit advances the queue", () => {
    const history = queue([
      { action: 1, lane: SyncLane },
      { action: 2, lane: SyncLane },
    ]);
    acknowledgeQueue(history, 1);
    (history.pending ??= []).push({ action: 3, lane: SyncLane });
    releaseQueueLanes(history, 2, SyncLane);
    expect(history.pending).toEqual([
      { action: 2, lane: NoLane },
      { action: 3, lane: SyncLane },
    ]);
  });
});
