/** Track an anchor without a permanent animation-frame loop. */
export function observePopupAnchor(
  anchor: HTMLElement,
  update: () => void,
  hidden: (value: boolean) => void,
  signal: AbortSignal,
  animation: boolean,
): () => void {
  const window = anchor.ownerDocument.defaultView!;
  let rect = anchor.getBoundingClientRect();
  let movement: IntersectionObserver | undefined;
  let frame = 0;
  let partiallyClipped = false;

  function check(): void {
    if (signal.aborted) return;
    const next = anchor.getBoundingClientRect();
    if (
      next.x !== rect.x ||
      next.y !== rect.y ||
      next.width !== rect.width ||
      next.height !== rect.height
    ) {
      rect = next;
      update();
      watchMovement();
    }
  }

  function tick(): void {
    frame = 0;
    check();
    if (!signal.aborted && (animation || partiallyClipped)) {
      frame = window.requestAnimationFrame(tick);
    }
  }

  function watchMovement(threshold = 1): void {
    movement?.disconnect();
    if (animation || rect.width === 0 || rect.height === 0) return;
    const document = anchor.ownerDocument.documentElement;
    // Shrink the observer's root to the anchor's current bounds. Moving any
    // edge changes its intersection, even when no element changes size.
    movement = new window.IntersectionObserver(
      (entries) => {
        if (signal.aborted) return;
        const previous = rect;
        check();
        const ratio = entries.at(-1)?.intersectionRatio ?? 1;
        // Fractional root margins can round inward. Calibrate against the
        // observed ratio so a fully visible anchor doesn't become untrackable.
        if (previous === rect && threshold === 1 && ratio > 0 && ratio < 1) {
          watchMovement(ratio);
        }
      },
      {
        rootMargin: `${-rect.top}px ${rect.right - document.clientWidth}px ${rect.bottom - document.clientHeight}px ${-rect.left}px`,
        threshold: [threshold, 1],
      },
    );
    movement.observe(anchor);
  }

  const visibility = new window.IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (signal.aborted || entry === undefined) return;
      hidden(
        entry.intersectionRect.width <= 0 || entry.intersectionRect.height <= 0,
      );
      // A clipped anchor can move while its visible intersection stays the
      // same. Check its bounds only while clipping makes observation ambiguous.
      partiallyClipped =
        entry.intersectionRatio > 0 && entry.intersectionRatio < 1;
      check();
      if (partiallyClipped && !frame)
        frame = window.requestAnimationFrame(tick);
    },
    { threshold: [0, 1] },
  );
  visibility.observe(anchor);
  watchMovement();
  window.addEventListener(
    "resize",
    () => {
      check();
      watchMovement();
    },
    { signal },
  );
  if (animation) frame = window.requestAnimationFrame(tick);
  signal.addEventListener(
    "abort",
    () => {
      visibility.disconnect();
      movement?.disconnect();
      window.cancelAnimationFrame(frame);
    },
    { once: true },
  );
  return check;
}
