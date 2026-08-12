/**
 * DOM bindings for the Fig Fast Refresh runtime.
 *
 * @module
 */
import {
  type RefreshAdapter,
  type RefreshFamily,
  type RefreshUpdate,
  setRefreshHandler,
} from "@bgub/fig-reconciler/refresh";
import { scheduleRefresh } from "./refresh-internal.ts";

export type { RefreshFamily, RefreshUpdate };
export { scheduleRefresh };

/** The DOM refresh adapter. */
export const domRefreshAdapter: RefreshAdapter = {
  scheduleRefresh,
  setRefreshHandler,
};
