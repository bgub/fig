export type PriorityLevel = 1 | 2 | 3 | 4 | 5;
export type SchedulerCallback = () => SchedulerCallback | undefined;

export interface ScheduledTask {
  cancel(): void;
}

export interface Scheduler {
  dispose(): void;
  forceFrameRate(fps: number): void;
  getCurrentPriorityLevel(): PriorityLevel;
  now(): number;
  requestPaint(): void;
  runWithPriority<T>(priority: PriorityLevel, callback: () => T): T;
  scheduleCallback(
    priority: PriorityLevel,
    callback: SchedulerCallback,
    options?: { delay?: number },
  ): ScheduledTask;
  shouldYieldToHost(): boolean;
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

function compare(a: { sortIndex: number; id: number }, b: typeof a): number {
  return a.sortIndex - b.sortIndex || a.id - b.id;
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

// Node macrotask scheduling without MessageChannel: a pending setImmediate
// keeps the process alive only until it fires, unlike a MessagePort with a
// message handler, which refs the event loop permanently — even idle.
declare const setImmediate: ((callback: () => void) => unknown) | undefined;

class DefaultScheduler implements Scheduler {
  // Created lazily on the first posted work loop (browser path only): an
  // import-time channel would keep every Node process that transitively
  // imports the scheduler alive forever.
  private channel: MessageChannel | null = null;
  private readonly taskQueue = new MinHeap<Task>();
  private readonly timerQueue = new MinHeap<Task>();
  private currentPriorityLevel: PriorityLevel = NormalPriority;
  private frameInterval = 5;
  private hostTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageLoopRunning = false;
  private needsPaint = false;
  private startTime = -1;
  private taskId = 1;

  now(): number {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  shouldYieldToHost(): boolean {
    return this.needsPaint || this.now() - this.startTime >= this.frameInterval;
  }

  requestPaint(): void {
    this.needsPaint = true;
  }

  forceFrameRate(fps: number): void {
    if (fps < 0 || fps > 125) return;
    this.frameInterval = fps > 0 ? Math.floor(1000 / fps) : 5;
  }

  getCurrentPriorityLevel(): PriorityLevel {
    return this.currentPriorityLevel;
  }

  // A MessagePort with a message handler refs the Node event loop, so a
  // transient scheduler would keep the process alive forever without this.
  // Pending tasks and timers are dropped.
  dispose(): void {
    this.messageLoopRunning = false;

    if (this.hostTimeout !== null) {
      clearTimeout(this.hostTimeout);
      this.hostTimeout = null;
    }

    if (this.channel !== null) {
      this.channel.port1.onmessage = null;
      this.channel.port1.close();
      this.channel.port2.close();
    }
  }

  runWithPriority<T>(priority: PriorityLevel, callback: () => T): T {
    const previousPriority = this.currentPriorityLevel;
    this.currentPriorityLevel = priority;

    try {
      return callback();
    } finally {
      this.currentPriorityLevel = previousPriority;
    }
  }

  scheduleCallback(
    priority: PriorityLevel,
    callback: SchedulerCallback,
    options: { delay?: number } = {},
  ): ScheduledTask {
    const currentTime = this.now();
    const start = currentTime + (options.delay ?? 0);
    const task: Task = {
      id: this.taskId++,
      callback,
      priority,
      startTime: start,
      expirationTime: start + priorityTimeouts[priority],
      sortIndex: start,
    };

    if (start > currentTime) {
      this.timerQueue.push(task);
      this.scheduleHostTimeout();
    } else {
      task.sortIndex = task.expirationTime;
      this.taskQueue.push(task);
      this.requestHostCallback();
    }

    return {
      cancel() {
        task.callback = null;
      },
    };
  }

  private requestHostCallback(): void {
    if (this.messageLoopRunning) return;
    this.messageLoopRunning = true;
    this.postMessageLoop();
  }

  private performWorkUntilDeadline(): void {
    if (!this.messageLoopRunning) return;

    this.needsPaint = false;
    this.startTime = this.now();

    let hasMoreWork = false;
    try {
      hasMoreWork = this.flushWork(this.startTime);
    } finally {
      if (hasMoreWork) {
        this.postMessageLoop();
      } else {
        this.messageLoopRunning = false;
      }
    }
  }

  private postMessageLoop(): void {
    if (typeof setImmediate === "function") {
      setImmediate(() => this.performWorkUntilDeadline());
      return;
    }

    if (typeof MessageChannel === "function") {
      if (this.channel === null) {
        this.channel = new MessageChannel();
        this.channel.port1.onmessage = () => this.performWorkUntilDeadline();
      }
      this.channel.port2.postMessage(null);
      return;
    }

    // setTimeout(0) is clamped (nested calls reach 4ms+), so it is the last
    // resort, not the default.
    setTimeout(() => this.performWorkUntilDeadline(), 0);
  }

  private flushWork(currentTime: number): boolean {
    this.advanceTimers(currentTime);

    let task = this.taskQueue.peek();
    while (task !== null) {
      if (task.expirationTime > currentTime && this.shouldYieldToHost()) break;

      const callback = task.callback;
      if (callback === null) {
        this.taskQueue.pop();
      } else {
        task.callback = null;
        const continuation = this.runWithPriority(task.priority, callback);

        if (typeof continuation === "function") {
          task.callback = continuation;
          task.sortIndex = task.expirationTime;
        } else if (task === this.taskQueue.peek()) {
          // The callback may have scheduled work that sorts ahead of this task,
          // so only pop when this task is still at the top of the heap; a stale
          // entry is skipped via its null callback when it surfaces later.
          this.taskQueue.pop();
        }
      }

      this.advanceTimers(this.now());
      task = this.taskQueue.peek();
    }

    if (task !== null) return true;

    this.scheduleHostTimeout();
    return false;
  }

  private advanceTimers(currentTime: number): void {
    let timer = this.timerQueue.peek();

    while (timer !== null) {
      if (timer.callback === null) {
        this.timerQueue.pop();
      } else if (timer.startTime <= currentTime) {
        this.timerQueue.pop();
        timer.sortIndex = timer.expirationTime;
        this.taskQueue.push(timer);
      } else {
        return;
      }

      timer = this.timerQueue.peek();
    }
  }

  private scheduleHostTimeout(): void {
    if (this.hostTimeout !== null) {
      clearTimeout(this.hostTimeout);
      this.hostTimeout = null;
    }

    const timer = this.timerQueue.peek();
    if (timer === null) return;

    this.hostTimeout = setTimeout(
      () => {
        this.hostTimeout = null;
        this.advanceTimers(this.now());
        if (this.taskQueue.peek() !== null) this.requestHostCallback();
        else this.scheduleHostTimeout();
      },
      Math.max(0, timer.startTime - this.now()),
    );
  }
}

const defaultScheduler = createScheduler();

export function createScheduler(): Scheduler {
  return new DefaultScheduler();
}

export function now(): number {
  return defaultScheduler.now();
}

export function shouldYieldToHost(): boolean {
  return defaultScheduler.shouldYieldToHost();
}

export function requestPaint(): void {
  defaultScheduler.requestPaint();
}

export function forceFrameRate(fps: number): void {
  defaultScheduler.forceFrameRate(fps);
}

export function getCurrentPriorityLevel(): PriorityLevel {
  return defaultScheduler.getCurrentPriorityLevel();
}

export function runWithPriority<T>(
  priority: PriorityLevel,
  callback: () => T,
): T {
  return defaultScheduler.runWithPriority(priority, callback);
}

export function scheduleCallback(
  priority: PriorityLevel,
  callback: SchedulerCallback,
  options: { delay?: number } = {},
): ScheduledTask {
  return defaultScheduler.scheduleCallback(priority, callback, options);
}
