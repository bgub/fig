import type { StateSetter } from "@bgub/fig";
import { type Lane, type Lanes, NoLane } from "./lanes.ts";

export type StateUpdate<S> = S | ((previous: S) => S);

export interface HookUpdate<S> {
  readonly action: StateUpdate<S>;
  readonly lane: Lane;
}

export interface HookQueue<S> {
  transitionLanes: Lanes;
  pending: HookUpdate<S>[] | null;
  // Absolute position of the first pending update.
  offset: number;
  dispatch: StateSetter<S> | null;
}

// A committed hook acknowledges only its observed prefix. Updates appended
// while rendering or during commit stay pending for the next attempt.
export function acknowledgeQueue<S>(
  queue: HookQueue<S>,
  through: number,
): void {
  const count = through - queue.offset;
  if (count <= 0 || queue.pending === null) return;
  if (count === queue.pending.length) queue.pending = null;
  else queue.pending.splice(0, count);
  queue.offset = through;
}

// A committed fallback makes attempted updates eligible on its retry lane.
// Skipped updates and updates arriving after the read boundary keep priority.
export function releaseQueueLanes<S>(
  queue: HookQueue<S>,
  through: number,
  lanes: Lanes,
): void {
  if (queue.pending === null) return;
  for (let i = 0; i < through - queue.offset; i += 1) {
    const update = queue.pending[i];
    if ((update.lane & lanes) !== NoLane)
      queue.pending[i] = { action: update.action, lane: NoLane };
  }
}
