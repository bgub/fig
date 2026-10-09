import { useBeforeLayout, useMemo, useStableEvent } from "@bgub/fig";
import { toggledOpen } from "./anchored-popup.ts";
import { type OpenStateOptions, useOpenState } from "./open-state.ts";

/**
 * Native popovers can dismiss during another widget's commit. Keep that
 * observation separate from rendered visibility and imperative intent, so a
 * stale layout effect cannot reopen a dismissed peer or reveal suspended UI.
 */
export function usePopupState(options: OpenStateOptions) {
  const state = useOpenState(options);
  const tracker = useMemo(
    () => ({ requested: state.open, native: undefined as boolean | undefined }),
    [],
  );
  const beforeToggleSources = useMemo(() => new WeakSet<EventTarget>(), []);
  useBeforeLayout(() => {
    if (options.open !== undefined) tracker.requested = state.open;
    if (state.open === tracker.requested) tracker.native = undefined;
  });
  const requestOpen = useStableEvent(
    (next: boolean, event: Event, trigger: Element | undefined) => {
      const accepted = state.requestOpen(next, event, trigger);
      if (accepted) tracker.requested = next;
      return accepted;
    },
  );
  const setOpen = useStableEvent((next: boolean) => {
    if (state.setOpen(next)) tracker.requested = next;
  });
  const nativeToggle = useStableEvent((event: Event) => {
    if (event.defaultPrevented) return;
    // beforetoggle is synchronous; toggle is a queued notification that can
    // arrive after a newer request. Once a host reports beforetoggle, its
    // later toggle notifications must not become fresh requests.
    if (event.target !== null) {
      if (event.type === "beforetoggle") beforeToggleSources.add(event.target);
      else if (beforeToggleSources.has(event.target)) return;
    }
    const next = toggledOpen(event);
    if (next === undefined) return;
    // Before/after notifications describe one transition, not two requests.
    if (next !== tracker.requested && !requestOpen(next, event, undefined)) {
      event.preventDefault();
      return;
    }
    tracker.native = next;
  });
  return {
    open: state.open,
    requestOpen,
    setOpen,
    nativeToggle,
    getOpen: () => tracker.native ?? state.open,
  };
}
