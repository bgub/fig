// Fig's cooperative task scheduler: a macrotask-hopping work loop with five
// priority tiers (mapped from lanes in lanes.ts) and starvation timeouts.
// Internal to fig-reconciler — the reconciler is its only consumer, so it is
// deliberately not a published package.

export type PriorityLevel = 1 | 2 | 3 | 4 | 5;
export type SchedulerCallback = () => SchedulerCallback | undefined;

export interface ScheduledTask {
  cancel(): void;
}

export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

// Starvation timeouts: once a task has waited this long it runs even past
// frame-budget yields (see flushWork's expiration check).
const priorityTimeouts: Record<PriorityLevel, number> = {
  [ImmediatePriority]: -1,
  [UserBlockingPriority]: 250,
  [NormalPriority]: 5_000,
  [LowPriority]: 10_000,
  [IdlePriority]: 1_073_741_823,
};

const frameInterval = 5;

interface Task {
  id: number;
  callback: SchedulerCallback | null;
  expirationTime: number;
}

function compare(a: Task, b: Task): number {
  return a.expirationTime - b.expirationTime || a.id - b.id;
}

class MinHeap {
  readonly items: Task[] = [];

  push(value: Task): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  peek(): Task | null {
    return this.items[0] ?? null;
  }

  pop(): Task | null {
    const first = this.items[0];
    const last = this.items.pop();

    if (first === undefined || last === undefined) return null;

    if (first !== last) {
      this.items[0] = last;
      this.siftDown(0);
    }

    return first;
  }

  private siftUp(index: number): void {
    const value = this.items[index];

    while (index > 0) {
      const parentIndex = (index - 1) >>> 1;
      const parent = this.items[parentIndex];
      if (compare(parent, value) <= 0) return;

      this.items[parentIndex] = value;
      this.items[index] = parent;
      index = parentIndex;
    }
  }

  private siftDown(index: number): void {
    const length = this.items.length;
    const value = this.items[index];

    while (index < length) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallest = index;

      if (
        leftIndex < length &&
        compare(this.items[leftIndex], this.items[smallest]) < 0
      ) {
        smallest = leftIndex;
      }

      if (
        rightIndex < length &&
        compare(this.items[rightIndex], this.items[smallest]) < 0
      ) {
        smallest = rightIndex;
      }

      if (smallest === index) return;

      this.items[index] = this.items[smallest];
      this.items[smallest] = value;
      index = smallest;
    }
  }
}

const taskQueue = new MinHeap();
let taskId = 1;
let messageLoopRunning = false;
let needsPaint = false;
let startTime = -1;
let actQueue: Task[] | null = null;
let actScopeDepth = 0;
let flushingActQueue = false;

const actFlushLimit = 1_000;

export function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function shouldYieldToHost(): boolean {
  return needsPaint || now() - startTime >= frameInterval;
}

// Renderers call this after committing host mutations: the next
// shouldYieldToHost() returns true, so the work loop hands the thread back
// and the host can paint before further scheduled work runs.
export function requestPaint(): void {
  needsPaint = true;
}

export function scheduleCallback(
  priority: PriorityLevel,
  callback: SchedulerCallback,
): ScheduledTask {
  const task: Task = {
    id: taskId++,
    callback,
    expirationTime: now() + priorityTimeouts[priority],
  };

  if (actQueue !== null) {
    actQueue.push(task);
  } else {
    taskQueue.push(task);
    requestHostCallback();
  }

  return {
    cancel() {
      task.callback = null;
    },
  };
}

export async function act<T>(
  callback: () => T | PromiseLike<T>,
): Promise<Awaited<T>> {
  const previousActQueue = actQueue;
  const previousActScopeDepth = actScopeDepth;
  const queue = previousActQueue ?? [];

  actQueue = queue;
  actScopeDepth = previousActScopeDepth + 1;

  try {
    const result = await callback();

    actScopeDepth = previousActScopeDepth;
    if (previousActScopeDepth === 0) {
      await flushActQueueUntilSettled(queue);
    }

    return result;
  } finally {
    actScopeDepth = previousActScopeDepth;
    actQueue = previousActQueue;
  }
}

async function flushActQueueUntilSettled(queue: Task[]): Promise<void> {
  for (let flushes = 0; flushes < actFlushLimit; flushes += 1) {
    flushActQueue(queue);
    await Promise.resolve();

    if (hasActWork(queue)) continue;

    await waitForActMacrotask();
    if (!hasActWork(queue)) {
      queue.length = 0;
      return;
    }
  }

  throw new Error("act() exceeded the scheduled work flush limit.");
}

function flushActQueue(queue: Task[]): void {
  if (flushingActQueue) return;

  flushingActQueue = true;
  try {
    let task = takeNextActTask(queue);
    while (task !== null) {
      const callback = task.callback;

      if (callback !== null) {
        task.callback = null;
        needsPaint = false;
        startTime = now();
        const continuation = callback();
        if (typeof continuation === "function") {
          task.callback = continuation;
          queue.push(task);
        }
      }

      task = takeNextActTask(queue);
    }
  } finally {
    flushingActQueue = false;
  }
}

function hasActWork(queue: Task[]): boolean {
  return queue.some((task) => task.callback !== null);
}

function takeNextActTask(queue: Task[]): Task | null {
  let nextIndex = -1;
  for (let index = 0; index < queue.length; index += 1) {
    const task = queue[index];
    if (task.callback === null) continue;

    if (nextIndex === -1 || compare(task, queue[nextIndex]) < 0) {
      nextIndex = index;
    }
  }

  if (nextIndex === -1) {
    queue.length = 0;
    return null;
  }

  const [task] = queue.splice(nextIndex, 1);
  return task;
}

function waitForActMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") {
      void setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function requestHostCallback(): void {
  if (messageLoopRunning) return;
  messageLoopRunning = true;
  scheduleHostCallback();
}

function performWorkUntilDeadline(): void {
  needsPaint = false;
  startTime = now();

  let hasMoreWork = false;
  try {
    hasMoreWork = flushWork(startTime);
  } finally {
    if (hasMoreWork) scheduleHostCallback();
    else messageLoopRunning = false;
  }
}

declare const setImmediate: ((callback: () => void) => unknown) | undefined;

let channel: MessageChannel | null = null;

// Host-callback preference, matching React's scheduler (facebook/react#20756):
// - setImmediate first (Node, old IE): unlike a MessagePort with a message
//   handler it never refs an idle event loop — importing the scheduler cannot
//   keep a Node process alive — and it fires earlier in the loop's turn.
//   Caveat shared with React: a page-level setImmediate polyfill would win
//   this check in a browser; real browsers never reach it natively.
// - MessageChannel in browsers, where setImmediate does not exist: preferred
//   over setTimeout because nested setTimeout(0) is clamped to 4ms+, wasting
//   most of a frame per work-loop hop. Created on the first post so module
//   evaluation allocates nothing.
// - setTimeout as the last resort for hosts with neither.
const scheduleHostCallback: () => void =
  typeof setImmediate === "function"
    ? () => void setImmediate(performWorkUntilDeadline)
    : typeof MessageChannel === "function"
      ? () => {
          if (channel === null) {
            channel = new MessageChannel();
            channel.port1.onmessage = () => performWorkUntilDeadline();
          }
          channel.port2.postMessage(null);
        }
      : () => void setTimeout(performWorkUntilDeadline, 0);

function flushWork(currentTime: number): boolean {
  let task = taskQueue.peek();
  while (task !== null) {
    if (task.expirationTime > currentTime && shouldYieldToHost()) break;

    const callback = task.callback;
    if (callback === null) {
      taskQueue.pop();
    } else {
      task.callback = null;
      const continuation = callback();

      if (typeof continuation === "function") {
        task.callback = continuation;
      } else if (task === taskQueue.peek()) {
        // The callback may have scheduled work that sorts ahead of this task,
        // so only pop when this task is still at the top of the heap; a stale
        // entry is skipped via its null callback when it surfaces later.
        taskQueue.pop();
      }
    }

    task = taskQueue.peek();
  }

  return task !== null;
}
