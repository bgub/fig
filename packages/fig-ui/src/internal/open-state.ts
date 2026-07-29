import { useMemo, useStableEvent, useState } from "@bgub/fig";
import { type ChangeDetails, createChangeDetails } from "./changes.ts";

export type OpenChangeDetails = ChangeDetails;

export type OpenChangeHandler = (
  open: boolean,
  details: OpenChangeDetails,
  signal: AbortSignal,
) => void;

export interface OpenStateOptions {
  defaultOpen?: boolean;
  onOpenChange?: OpenChangeHandler;
  open?: boolean;
  /** Runs when the element moved but state did not follow. */
  requestReconcile: () => void;
}

/**
 * Open state for a widget whose element can open and close on its own.
 *
 * A `<dialog>` closes on Escape and a popover light-dismisses, so the element
 * reports what happened rather than waiting to be told. Two things follow.
 * Intent settles synchronously, because the element emits its before and after
 * events in one tick and a single dismissal must report once. And when a
 * change did not become state — a controlled owner that kept `open`, or a
 * handler that refused — the widget reconciles, so the next pass restores the
 * owner's intent over whatever the element did.
 */
export function useOpenState(options: OpenStateOptions) {
  const controlled = options.open !== undefined;
  const [uncontrolled, setUncontrolled] = useState(
    options.defaultOpen === true,
  );
  const open = controlled ? options.open === true : uncontrolled;
  const tracker = useMemo(() => ({ open }), []);
  tracker.open = open;

  const emitOpenChange = useStableEvent(
    (next: boolean, details: OpenChangeDetails, signal: AbortSignal) => {
      options.onOpenChange?.(next, details, signal);
    },
  );

  /** Reports a change the element proposed. Returns whether it was accepted. */
  const requestOpen = useStableEvent(
    (next: boolean, event: Event, trigger: Element | undefined) => {
      if (next === tracker.open) return true;
      const details = createChangeDetails(event, trigger);
      emitOpenChange(next, details);
      if (details.isCanceled) {
        options.requestReconcile();
        return false;
      }
      tracker.open = next;
      if (controlled) options.requestReconcile();
      else setUncontrolled(next);
      return true;
    },
  );

  /** Opens or closes without an activation event. */
  const setOpen = useStableEvent((next: boolean) => {
    if (next === tracker.open) return;
    const details = createChangeDetails(null);
    emitOpenChange(next, details);
    if (details.isCanceled) return;
    tracker.open = next;
    if (controlled) options.requestReconcile();
    else setUncontrolled(next);
  });

  return { open, requestOpen, setOpen };
}
