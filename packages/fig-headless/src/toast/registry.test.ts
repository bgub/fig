// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createToastRegistry } from "./registry.ts";
afterEach(() => vi.useRealTimers());

it("preserves elapsed time on configuration refreshes and cancels synchronously on removal", () => {
  vi.useFakeTimers();
  const timeout = vi.fn(),
    registry = createToastRegistry(() => {}, timeout);
  const node = document.createElement("div"),
    lifetime = new AbortController();
  registry.bindToast(node, lifetime.signal, { value: "saved", duration: 100 });
  vi.advanceTimersByTime(75);
  registry.bindToast(node, lifetime.signal, { value: "saved", duration: 100 });
  vi.advanceTimersByTime(25);
  expect(timeout).toHaveBeenCalledOnce();
  registry.bindToast(node, lifetime.signal, { value: "new", duration: 100 });
  lifetime.abort();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(100);
  expect(timeout).toHaveBeenCalledOnce();
});

it("updates timeout configuration with one cleanup per host lifetime", () => {
  vi.useFakeTimers();
  const timeout = vi.fn(),
    registry = createToastRegistry(() => {}, timeout);
  const node = document.createElement("div"),
    lifetime = new AbortController();
  const listener = vi.spyOn(lifetime.signal, "addEventListener");
  for (let value = 0; value < 10; value++)
    registry.bindToast(node, lifetime.signal, { value, duration: 100 });
  expect(listener).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(100);
  expect(timeout).toHaveBeenCalledOnce();
  expect(timeout.mock.calls[0]![0].value).toBe(9);
  lifetime.abort();
});
