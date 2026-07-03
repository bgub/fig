import { describe, expect, it, vi } from "vite-plus/test";
import {
  createScheduler,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  requestPaint,
  scheduleCallback,
  shouldYieldToHost,
} from "./index.ts";

const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("@bgub/fig-scheduler", () => {
  it("runs higher priority tasks first", async () => {
    const calls: string[] = [];

    scheduleCallback(NormalPriority, () => {
      calls.push("normal");
    });
    scheduleCallback(ImmediatePriority, () => {
      calls.push("immediate");
    });

    await delay();
    expect(calls).toEqual(["immediate", "normal"]);
  });

  it("does not run cancelled delayed tasks", async () => {
    const calls: string[] = [];
    const task = scheduleCallback(
      NormalPriority,
      () => {
        calls.push("delayed");
      },
      { delay: 5 },
    );

    task.cancel();

    await delay();
    expect(calls).toEqual([]);
  });

  it("keeps tasks scheduled by a lower priority callback", async () => {
    const calls: string[] = [];

    scheduleCallback(LowPriority, () => {
      calls.push("low");
      scheduleCallback(NormalPriority, () => {
        calls.push("normal");
      });
    });

    await delay();
    expect(calls).toEqual(["low", "normal"]);
  });

  it("resumes continuation callbacks after yielding for paint", async () => {
    const calls: string[] = [];

    scheduleCallback(NormalPriority, () => {
      calls.push(`first:${shouldYieldToHost()}`);
      requestPaint();
      calls.push(`yield:${shouldYieldToHost()}`);
      return () => {
        calls.push("second");
      };
    });

    await delay();
    expect(calls).toEqual(["first:false", "yield:true", "second"]);
  });

  it("stops running work after dispose", async () => {
    const scheduler = createScheduler();
    const calls: string[] = [];

    scheduler.scheduleCallback(NormalPriority, () => {
      calls.push("immediate");
    });
    scheduler.scheduleCallback(
      NormalPriority,
      () => {
        calls.push("delayed");
      },
      { delay: 5 },
    );

    scheduler.dispose();
    scheduler.dispose();

    await delay();
    expect(calls).toEqual([]);
  });

  it("does not construct a MessageChannel at import time", async () => {
    // A MessagePort with a message handler refs the Node event loop forever,
    // so an import-time channel keeps any process that transitively imports
    // the scheduler alive. The channel must be lazy (and unused under Node,
    // where setImmediate is preferred).
    const RealMessageChannel = globalThis.MessageChannel;
    let constructed = 0;
    vi.stubGlobal(
      "MessageChannel",
      class extends RealMessageChannel {
        constructor() {
          super();
          constructed += 1;
        }
      },
    );
    vi.resetModules();

    try {
      await import("./index.ts");
      expect(constructed).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates isolated scheduler instances", async () => {
    const first = createScheduler();
    const second = createScheduler();
    const calls: string[] = [];

    first.scheduleCallback(NormalPriority, () => {
      calls.push(`first:${first.getCurrentPriorityLevel()}`);
    });
    second.scheduleCallback(ImmediatePriority, () => {
      calls.push(`second:${second.getCurrentPriorityLevel()}`);
    });

    await delay();
    expect([...calls].sort()).toEqual(
      [`first:${NormalPriority}`, `second:${ImmediatePriority}`].sort(),
    );
  });
});
