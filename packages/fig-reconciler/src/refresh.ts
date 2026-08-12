/**
 * Renderer-side contracts for Fig Fast Refresh.
 *
 * @module
 */
import { setRefreshHandlerState } from "./refresh-internal.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

// A family groups every version of a component across hot edits; `current` is
// the latest implementation. The handler is module-global within one
// renderer-owned reconciler so module-level reconcile helpers can consult it.
// In production no handler is ever set, so this collapses to identity paths.
/** Describes refresh family. */
export interface RefreshFamily {
  current: unknown;
}

/** Describes refresh update. */
export interface RefreshUpdate {
  staleFamilies: Set<RefreshFamily>;
  updatedFamilies: Set<RefreshFamily>;
}

/** Describes refresh adapter. */
export interface RefreshAdapter {
  setRefreshHandler(
    handler: (type: unknown) => RefreshFamily | undefined,
  ): void;
  scheduleRefresh(update: RefreshUpdate): void;
}

/** Sets refresh handler. */
export function setRefreshHandler(
  handler: ((type: unknown) => RefreshFamily | undefined) | null,
): void {
  if (__DEV__) {
    setRefreshHandlerState(handler);
  }
}
