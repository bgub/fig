import {
  useBeforePaint,
  useBeforeLayout,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";

/**
 * Lets a widget root notice the DOM moving without it rendering.
 *
 * Two things cause that: a descendant component owning part of the markup, so
 * parts mount and unmount on their own, and a host element that changes itself
 * — a `<dialog>` closing on Escape. Either way the root has to render for its
 * before-paint pass to reconcile against the committed DOM. The guard matters:
 * part configurations update during a commit, and those registrations are
 * already covered by that commit’s before-paint pass.
 */
export function useRegistrationReconcile(): () => void {
  const tracker = useMemo(() => ({ reconciled: false }), []);
  // Binds run after this render, so they belong to it and need no extra work.
  useBeforeLayout(() => {
    tracker.reconciled = false;
  });
  const [, requestReconcile] = useState(0);

  useBeforePaint(() => {
    tracker.reconciled = true;
  });

  return useStableEvent((signal: AbortSignal) => {
    if (signal.aborted || !tracker.reconciled) return;
    tracker.reconciled = false;
    requestReconcile((epoch) => epoch + 1);
  });
}
