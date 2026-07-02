import type {
  RefreshFamily,
  RefreshUpdate,
} from "@bgub/fig-reconciler/refresh";

let scheduleDomRefresh: ((update: RefreshUpdate) => void) | null = null;

export type { RefreshFamily, RefreshUpdate };

export function configureDomRefreshScheduler(
  scheduleRefresh: (update: RefreshUpdate) => void,
): void {
  scheduleDomRefresh = scheduleRefresh;
}

export function scheduleRefresh(update: RefreshUpdate): void {
  scheduleDomRefresh?.(update);
}
