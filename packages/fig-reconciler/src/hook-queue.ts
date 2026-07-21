import type { StateSetter } from "@bgub/fig";
import { type Lane, NoLane } from "./lanes.ts";

export type StateUpdate<S> = S | ((previous: S) => S);

export class HookUpdate<S> {
  next: HookUpdate<S> = this;

  constructor(
    readonly action: StateUpdate<S>,
    public lane: Lane,
  ) {}
}

export interface HookQueue<S> {
  pending: HookUpdate<S> | null;
  dispatch: StateSetter<S> | null;
}

// Hook queues are circular lists whose tail points at the first update. These
// operations keep the pointer manipulation in one place so render retries and
// rebasing share exactly the same ordering rules.
export function mergeQueues<S>(
  baseQueue: HookUpdate<S> | null,
  pendingQueue: HookUpdate<S>,
): HookUpdate<S> {
  if (baseQueue === null) return pendingQueue;

  const baseFirst = baseQueue.next;
  const pendingFirst = pendingQueue.next;
  baseQueue.next = pendingFirst;
  pendingQueue.next = baseFirst;
  return pendingQueue;
}

export function cloneUpdateNode<S>(update: HookUpdate<S>): HookUpdate<S> {
  return new HookUpdate(update.action, update.lane);
}

export function cloneQueue<S>(
  queue: HookUpdate<S> | null,
): HookUpdate<S> | null {
  return queue === null ? null : cloneQueueNodes(queue);
}

export function cloneQueueNodes<S>(queue: HookUpdate<S>): HookUpdate<S> {
  const first = queue.next;
  let clone = cloneUpdateNode(first);
  let update = first.next;

  while (update !== first) {
    clone = mergeQueues(clone, cloneUpdateNode(update));
    update = update.next;
  }

  return clone;
}

export function clearQueueLanes<S>(queue: HookUpdate<S>): void {
  let update = queue.next;
  do {
    update.lane = NoLane;
    update = update.next;
  } while (update !== queue.next);
}
