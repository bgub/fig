// Shared contract between the server handler (which serializes) and the client
// bootstrap (which reads) so router + data hydration stay in lockstep.

export const ROUTER_STATE_SCRIPT_ID = "__fig_start_state__";
export const DATA_SCRIPT_ID = "__fig_start_data__";
export const RSC_PAYLOAD_SCRIPT_ID = "__fig_start_rsc__";
export const ROOT_ELEMENT_ID = "fig-root";
// Marks the empty DOM slot a `.server.tsx` (RSC) route leaves in the SSR'd
// layout; the client mounts the streamed RSC payload into it.
export const RSC_SLOT_ATTR = "data-fig-rsc-slot";

export interface SerializedRouterState {
  // Per-route loader return values, keyed by route id, so the client hydrates
  // without re-running loaders on first paint.
  href: string;
  loaderData: Record<string, unknown>;
}

export interface SerializedRscPayload {
  // The matched server route's id and its drained RSC row stream, inlined on the
  // initial document so the client renders it with no extra round-trip.
  routeId: string;
  rows: string;
}
