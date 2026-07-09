import type { StateSetter } from "@bgub/fig";
import { type Lane, NoLane } from "./lanes.ts";

export type StateUpdate<S> = S | ((previous: S) => S);

export interface HookUpdate<S> {
  action: StateUpdate<S>;
  lane: Lane;
  next: HookUpdate<S>;
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
  const clone: HookUpdate<S> = {
    action: update.action,
    lane: update.lane,
    next: null as never,
  };
  clone.next = clone;
  return clone;
}

export function cloneQueue<S>(
  queue: HookUpdate<S> | null,
): HookUpdate<S> | null {
  return queue === null ? null : cloneQueueNodes(queue);
}

export function cloneQueueNodes<S>(queue: HookUpdate<S>): HookUpdate<S> {
  let clone: HookUpdate<S> | null = null;
  let update = queue.next;

  do {
    clone = mergeQueues(clone, cloneUpdateNode(update));
    update = update.next;
  } while (update !== queue.next);

  return clone as HookUpdate<S>;
}

export function clearQueueLanes(queue: HookUpdate<unknown>): void {
  let update = queue.next;
  do {
    update.lane = NoLane;
    update = update.next;
  } while (update !== queue.next);
}
