// Shared contract between the server handler (which serializes) and the client
// bootstrap (which reads) so router + data hydration stay in lockstep.

export const ROUTER_STATE_SCRIPT_ID = "__fig_start_state__";
export const DATA_SCRIPT_ID = "__fig_start_data__";
export const ROOT_ELEMENT_ID = "fig-root";

export interface SerializedRouterState {
  // Per-route loader return values, keyed by route id, so the client hydrates
  // without re-running loaders on first paint.
  href: string;
  loaderData: Record<string, unknown>;
}
