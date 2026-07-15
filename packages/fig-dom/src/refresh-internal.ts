import type { RefreshUpdate } from "@bgub/fig-reconciler/refresh";

let scheduleDomRefresh: ((update: RefreshUpdate) => void) | null = null;

// Updates that arrive before the @bgub/fig-dom main entry has evaluated (it
// configures the scheduler as a module side effect). A code-split app can load
// this entry first, and dropping those updates would silently skip a refresh.
let pendingUpdates: RefreshUpdate[] | null = null;

export function configureDomRefreshScheduler(
  scheduleRefresh: (update: RefreshUpdate) => void,
): void {
  scheduleDomRefresh = scheduleRefresh;

  if (pendingUpdates !== null) {
    const updates = pendingUpdates;
    pendingUpdates = null;
    for (const update of updates) scheduleRefresh(update);
  }
}

export function scheduleRefresh(update: RefreshUpdate): void {
  if (scheduleDomRefresh === null) {
    (pendingUpdates ??= []).push(update);
    return;
  }

  scheduleDomRefresh(update);
}
