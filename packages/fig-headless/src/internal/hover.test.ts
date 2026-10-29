// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createHoverIntent } from "./hover.ts";
import { trackHoverTransit } from "./hover-transit.ts";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("replaces pending work, releases abort listeners, and preserves closing deadlines", () => {
  vi.useFakeTimers();
  const intent = createHoverIntent();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const open = vi.fn();
  const close = vi.fn();
  intent.schedule(true, open, 100, controller.signal);
  vi.advanceTimersByTime(50);
  intent.schedule(false, close, 100, controller.signal);
  expect(remove).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(50);
  intent.cancelOpening();
  expect(open).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(close).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(2);
});

it("cancels openings on disability and all pending work on abort", () => {
  vi.useFakeTimers();
  const intent = createHoverIntent();
  const controller = new AbortController();
  const change = vi.fn();
  intent.schedule(true, change, 100, controller.signal);
  intent.cancelOpening();
  vi.advanceTimersByTime(100);
  intent.schedule(false, change, 100, controller.signal);
  controller.abort();
  vi.advanceTimersByTime(100);
  intent.schedule(true, change, 100, controller.signal);
  vi.advanceTimersByTime(100);
  expect(change).not.toHaveBeenCalled();
});

it.each([
  [new DOMRect(100, 0, 100, 100), [0, 50], [50, 70], [150, 80]],
  [new DOMRect(-200, 0, 100, 100), [0, 50], [-50, 70], [-150, 80]],
  [new DOMRect(0, 100, 100, 100), [50, 0], [70, 50], [80, 150]],
  [new DOMRect(0, -200, 100, 100), [50, 0], [70, -50], [80, -150]],
  [new DOMRect(0, 0, 40, 30), [70, 150], [45, 80], [20, 20]],
  [new DOMRect(0, 0, 40, 30), [70, -150], [45, -80], [20, 10]],
] as const)(
  "keeps diagonal travel safe for placed bounds %j",
  (rect, start, gap, end) => {
    vi.useFakeTimers();
    const target = document.createElement("div");
    document.body.append(target);
    target.getBoundingClientRect = () => rect;
    const controller = new AbortController();
    const close = vi.fn();
    trackHoverTransit(
      pointer("pointerleave", start[0], start[1]),
      target,
      close,
      100,
      controller.signal,
    );
    document.dispatchEvent(pointer("pointermove", gap[0], gap[1]));
    vi.advanceTimersByTime(200);
    expect(close).not.toHaveBeenCalled();
    document.dispatchEvent(pointer("pointermove", end[0], end[1]));
    vi.advanceTimersByTime(1000);
    expect(close).not.toHaveBeenCalled();
    controller.abort();
  },
);

it.each(["exit", "idle", "removed", "abort"])(
  "ends travel on %s and releases its document listener",
  (reason) => {
    vi.useFakeTimers();
    const target = document.createElement("div");
    document.body.append(target);
    target.getBoundingClientRect = () => new DOMRect(100, 0, 100, 100);
    const controller = new AbortController();
    const close = vi.fn();
    const remove = vi.spyOn(document, "removeEventListener");
    trackHoverTransit(
      pointer("pointerleave", 0, 50),
      target,
      close,
      100,
      controller.signal,
    );
    if (reason === "abort") controller.abort();
    if (reason === "removed") target.remove();
    if (reason === "exit" || reason === "removed")
      document.dispatchEvent(pointer("pointermove", -50, 50));
    vi.advanceTimersByTime(1000);
    expect(close).toHaveBeenCalledTimes(reason === "abort" ? 0 : 1);
    expect(remove).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
      true,
    );
    controller.abort();
    remove.mockRestore();
  },
);

function pointer(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { pointerType: "mouse", clientX, clientY });
}
