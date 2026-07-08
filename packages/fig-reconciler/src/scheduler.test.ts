import { describe, expect, it, vi } from "vite-plus/test";
import {
  act,
  ImmediatePriority,
  LowPriority,
  NormalPriority,
  requestPaint,
  scheduleCallback,
  shouldYieldToHost,
} from "./scheduler.ts";

const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("scheduler", () => {
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

  it("does not run cancelled tasks", async () => {
    const calls: string[] = [];
    const task = scheduleCallback(NormalPriority, () => {
      calls.push("cancelled");
    });

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

  it("captures scheduled work during an act scope", async () => {
    const calls: string[] = [];

    await act(async () => {
      scheduleCallback(NormalPriority, () => {
        calls.push("normal");
      });
      const cancelled = scheduleCallback(ImmediatePriority, () => {
        calls.push("cancelled");
      });

      cancelled.cancel();
      await Promise.resolve();

      scheduleCallback(ImmediatePriority, () => {
        calls.push("immediate");
      });

      expect(calls).toEqual([]);
    });

    expect(calls).toEqual(["immediate", "normal"]);
  });

  it("drains act continuations and microtask-scheduled work", async () => {
    const calls: string[] = [];

    await act(() => {
      scheduleCallback(NormalPriority, () => {
        calls.push("first");
        void Promise.resolve().then(() => {
          scheduleCallback(NormalPriority, () => {
            calls.push("third");
          });
        });

        return () => {
          calls.push("second");
        };
      });
    });

    expect(calls).toEqual(["first", "second", "third"]);
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
      await import("./scheduler.ts");
      expect(constructed).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
