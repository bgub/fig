export type PriorityLevel = 1 | 2 | 3 | 4 | 5;
export type SchedulerCallback = () => SchedulerCallback | undefined;

export interface ScheduledTask {
  cancel(): void;
}

interface Task {
  id: number;
  callback: SchedulerCallback | null;
  priority: PriorityLevel;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
}

export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

const priorityTimeouts: Record<PriorityLevel, number> = {
  [ImmediatePriority]: -1,
  [UserBlockingPriority]: 250,
  [NormalPriority]: 5_000,
  [LowPriority]: 10_000,
  [IdlePriority]: 1_073_741_823,
};

let frameInterval = 5;
let startTime = -1;
let taskId = 1;
let currentPriorityLevel: PriorityLevel = NormalPriority;
let messageLoopRunning = false;
let hostTimeout: ReturnType<typeof setTimeout> | null = null;
let needsPaint = false;

let taskQueue: MinHeap<Task>;
let timerQueue: MinHeap<Task>;
const channel =
  typeof MessageChannel === "function" ? new MessageChannel() : null;

if (channel !== null) {
  channel.port1.onmessage = performWorkUntilDeadline;
}

export function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function shouldYieldToHost(): boolean {
  return needsPaint || now() - startTime >= frameInterval;
}

export function requestPaint(): void {
  needsPaint = true;
}

export function forceFrameRate(fps: number): void {
  if (fps < 0 || fps > 125) return;
  frameInterval = fps > 0 ? Math.floor(1000 / fps) : 5;
}

export function getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

export function runWithPriority<T>(
  priority: PriorityLevel,
  callback: () => T,
): T {
  const previousPriority = currentPriorityLevel;
  currentPriorityLevel = priority;

  try {
    return callback();
  } finally {
    currentPriorityLevel = previousPriority;
  }
}

export function scheduleCallback(
  priority: PriorityLevel,
  callback: SchedulerCallback,
  options: { delay?: number } = {},
): ScheduledTask {
  const currentTime = now();
  const start = currentTime + (options.delay ?? 0);
  const task: Task = {
    id: taskId++,
    callback,
    priority,
    startTime: start,
    expirationTime: start + priorityTimeouts[priority],
    sortIndex: start,
  };

  if (start > currentTime) {
    timerQueue.push(task);
    scheduleHostTimeout();
  } else {
    task.sortIndex = task.expirationTime;
    taskQueue.push(task);
    requestHostCallback();
  }

  return {
    cancel() {
      task.callback = null;
    },
  };
}

function requestHostCallback(): void {
  if (messageLoopRunning) return;
  messageLoopRunning = true;
  postMessageLoop();
}

function performWorkUntilDeadline(): void {
  if (!messageLoopRunning) return;

  needsPaint = false;
  startTime = now();

  const hasMoreWork = flushWork(startTime);
  if (hasMoreWork) {
    postMessageLoop();
  } else {
    messageLoopRunning = false;
  }
}

function postMessageLoop(): void {
  if (channel !== null) {
    channel.port2.postMessage(null);
  } else {
    setTimeout(performWorkUntilDeadline, 0);
  }
}

function flushWork(currentTime: number): boolean {
  advanceTimers(currentTime);

  let task = taskQueue.peek();
  while (task !== null) {
    if (task.expirationTime > currentTime && shouldYieldToHost()) break;

    const callback = task.callback;
    if (callback === null) {
      taskQueue.pop();
    } else {
      task.callback = null;
      const continuation = runWithPriority(task.priority, callback);

      if (typeof continuation === "function") {
        task.callback = continuation;
        task.sortIndex = task.expirationTime;
      } else {
        taskQueue.pop();
      }
    }

    advanceTimers(now());
    task = taskQueue.peek();
  }

  if (task !== null) return true;

  scheduleHostTimeout();
  return false;
}

function advanceTimers(currentTime: number): void {
  let timer = timerQueue.peek();

  while (timer !== null) {
    if (timer.callback === null) {
      timerQueue.pop();
    } else if (timer.startTime <= currentTime) {
      timerQueue.pop();
      timer.sortIndex = timer.expirationTime;
      taskQueue.push(timer);
    } else {
      return;
    }

    timer = timerQueue.peek();
  }
}

function scheduleHostTimeout(): void {
  if (hostTimeout !== null) {
    clearTimeout(hostTimeout);
    hostTimeout = null;
  }

  const timer = timerQueue.peek();
  if (timer === null) return;

  hostTimeout = setTimeout(
    () => {
      hostTimeout = null;
      advanceTimers(now());
      if (taskQueue.peek() !== null) requestHostCallback();
      else scheduleHostTimeout();
    },
    Math.max(0, timer.startTime - now()),
  );
}

class MinHeap<T extends { sortIndex: number; id: number }> {
  readonly items: T[] = [];

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  peek(): T | null {
    return this.items[0] ?? null;
  }

  pop(): T | null {
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

taskQueue = new MinHeap<Task>();
timerQueue = new MinHeap<Task>();

function compare(a: { sortIndex: number; id: number }, b: typeof a): number {
  return a.sortIndex - b.sortIndex || a.id - b.id;
}
