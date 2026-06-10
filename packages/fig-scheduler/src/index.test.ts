import { describe, expect, it } from "vite-plus/test";
import {
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
});
