import {
  type RefreshAdapter,
  type RefreshFamily,
  type RefreshUpdate,
  setRefreshHandler,
} from "@bgub/fig-reconciler/refresh";
import { scheduleRefresh } from "./refresh-internal.ts";

export type { RefreshFamily, RefreshUpdate };
export { scheduleRefresh };

export const domRefreshAdapter: RefreshAdapter = {
  scheduleRefresh,
  setRefreshHandler,
};
