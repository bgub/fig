import { setRefreshHandlerState } from "./refresh-state.ts";

declare const process: { env?: { NODE_ENV?: string } } | undefined;

const __DEV__ =
  typeof process === "undefined" || process.env?.NODE_ENV !== "production";

// A family groups every version of a component across hot edits; `current` is
// the latest implementation. The handler is module-global (one refresh runtime
// per app) so module-level reconcile helpers can consult it. In production no
// handler is ever set, so all of this collapses to identity/equality paths.
export interface RefreshFamily {
  current: unknown;
}

export interface RefreshUpdate {
  staleFamilies: Set<RefreshFamily>;
  updatedFamilies: Set<RefreshFamily>;
}

export function setRefreshHandler(
  handler: ((type: unknown) => RefreshFamily | undefined) | null,
): void {
  if (__DEV__) {
    setRefreshHandlerState(handler);
  }
}
