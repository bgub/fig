import { createHoverIntent } from "./hover.ts";

/** Keep a popup reachable across a gap, using its placed bounds, not its CSS side. */
export function trackHoverTransit(
  leave: PointerEvent,
  target: HTMLElement,
  close: () => void,
  delay: number,
  signal: AbortSignal,
): void {
  if (signal.aborted) return;
  const intent = createHoverIntent();
  const document = target.ownerDocument;
  const start = { x: leave.clientX, y: leave.clientY };
  function stop(): void {
    intent.cancel();
    document.removeEventListener("pointermove", move, true);
    signal.removeEventListener("abort", stop);
  }
  function finish(): void {
    stop();
    close();
  }
  function move(event: PointerEvent): void {
    if (event.pointerType !== "mouse") return;
    const rect = target.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    if (
      target.isConnected &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      stop();
      return;
    }
    if (!target.isConnected || !inCorridor(start, point, rect)) {
      stop();
      intent.schedule(false, close, delay, signal);
      return;
    }
    // A stationary pointer must not leave the popup stuck open indefinitely.
    intent.schedule(false, finish, Math.max(delay, 300), signal);
  }
  document.addEventListener("pointermove", move, true);
  signal.addEventListener("abort", stop, { once: true });
  intent.schedule(false, finish, Math.max(delay, 300), signal);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function inCorridor(start: Point, point: Point, rect: DOMRect): boolean {
  // Choose the facing edge in either axis. This also covers RTL and CSS flips.
  let a: Point;
  let b: Point;
  const dx = Math.max(rect.left - start.x, 0, start.x - rect.right);
  const dy = Math.max(rect.top - start.y, 0, start.y - rect.bottom);
  if (dx > dy) {
    const x = start.x < rect.left ? rect.left : rect.right;
    a = { x, y: rect.top - 4 };
    b = { x, y: rect.bottom + 4 };
  } else {
    const y = start.y < rect.top ? rect.top : rect.bottom;
    a = { x: rect.left - 4, y };
    b = { x: rect.right + 4, y };
  }
  const first = cross(start, a, point);
  const second = cross(a, b, point);
  const third = cross(b, start, point);
  return !(
    Math.min(first, second, third) < 0 && Math.max(first, second, third) > 0
  );
}

function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}
