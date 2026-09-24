import { expect, it } from "vitest";
import {
  runTransitionScope,
  transition,
  type TransitionUpdate,
} from "./transition.ts";

it("returns the original result and retires synchronous renderer-free scopes", () => {
  let late!: TransitionUpdate;
  let captured!: AbortSignal;
  let calls = 0;
  const result = transition((signal, update) => {
    captured = signal;
    late = update;
    expect(signal.aborted).toBe(false);
    update(() => {
      calls++;
    });
    return 42;
  });
  expect(result).toBe(42);
  expect(captured.aborted).toBe(true);
  late(() => {
    calls++;
  });
  expect(calls).toBe(1);
});

it("returns the original promise and retires rejected scopes", async () => {
  const failure = new Error("failed");
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  let late!: TransitionUpdate;
  let captured!: AbortSignal;
  const result = transition((signal, update) => {
    captured = signal;
    late = update;
    return pending;
  });
  expect(result).toBe(pending);
  expect(captured.aborted).toBe(false);
  reject(failure);
  await expect(result).rejects.toBe(failure);
  expect(captured.aborted).toBe(true);
  late(() => {
    throw new Error("must not run");
  });
});

it("retires a throwing scope and rejects asynchronous update callbacks", () => {
  let captured!: AbortSignal;
  expect(() =>
    runTransitionScope(
      (signal, update) => {
        captured = signal;
        update(async () => {
          await Promise.resolve();
        });
      },
      (run) => run(),
    ),
  ).toThrow("Transition update callbacks must be synchronous.");
  expect(captured.aborted).toBe(true);
});
