import { useBeforeLayout, useMemo, useStableEvent, useState } from "@bgub/fig";
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
 * Intent settles synchronously, so the element's before and after events for
 * a single dismissal report once even when delivered in different tasks. When a
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
  const tracker = useMemo<{
    controlled: boolean;
    requestedOpen: boolean;
    nativeOpen: boolean | undefined;
  }>(() => ({ controlled, requestedOpen: open, nativeOpen: undefined }), []);
  useBeforeLayout(() => {
    // Uncontrolled requests may still be queued in a lower-priority lane.
    // An unrelated commit must not erase their intent before native dismissal
    // can supersede them. Only a committed owner prop (or a mode change)
    // replaces that intent; suspended renders must not publish owner props.
    if (controlled || tracker.controlled !== controlled) {
      tracker.requestedOpen = open;
    }
    if (open === tracker.requestedOpen) tracker.nativeOpen = undefined;
    tracker.controlled = controlled;
  });

  const emitOpenChange = useStableEvent(
    (next: boolean, details: OpenChangeDetails, signal: AbortSignal) => {
      options.onOpenChange?.(next, details, signal);
    },
  );

  /** Reports a change the element proposed. Returns whether it was accepted. */
  const requestOpen = useStableEvent(
    (next: boolean, event: Event, trigger: Element | undefined) => {
      if (next !== tracker.requestedOpen) {
        const details = createChangeDetails(event, trigger);
        emitOpenChange(next, details);
        if (details.isCanceled) {
          options.requestReconcile();
          return false;
        }
        tracker.requestedOpen = next;
        if (controlled) options.requestReconcile();
        else setUncontrolled(next);
      }
      // Clicks and input events request state; only native popup transitions
      // can change visibility ahead of that state's commit.
      if (event.type === "beforetoggle" || event.type === "toggle")
        tracker.nativeOpen = next;
      return true;
    },
  );

  /** Opens or closes without an activation event. */
  const setOpen = useStableEvent((next: boolean) => {
    if (next === tracker.requestedOpen) return;
    const details = createChangeDetails(null);
    emitOpenChange(next, details);
    if (details.isCanceled) return;
    tracker.requestedOpen = next;
    if (controlled) options.requestReconcile();
    else setUncontrolled(next);
  });

  // Opening another auto popover can synchronously dismiss this one during
  // before-paint work. Honor native changes until their state commits, while
  // imperative requests cannot reveal suspended content before it commits.
  const getOpen = () => tracker.nativeOpen ?? open;
  return { getOpen, open, requestOpen, setOpen };
}
