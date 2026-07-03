// Shared contract between the server handler (which serializes) and the client
// bootstrap (which reads) so router + data hydration stay in lockstep.

export const ROUTER_STATE_SCRIPT_ID = "__fig_start_state__";
export const DATA_SCRIPT_ID = "__fig_start_data__";
export const DATA_FRAME_ATTR = "data-fig-data-frame";
export const DATA_STREAM_GLOBAL = "__figStartData";
export const RSC_SEGMENTS_SCRIPT_ID = "__fig_start_rsc_segments__";
export const RSC_FRAME_ATTR = "data-fig-rsc-frame";
export const RSC_STREAM_GLOBAL = "__figStartRSC";
export const CLIENT_REFERENCE_MODULES_GLOBAL = "__figStartClientReferences";
export const RSC_BOUNDARY_HEADER = "x-fig-rsc-boundary";
export const RSC_ROUTE_ID_HEADER = "x-fig-rsc-route-id";
export const RSC_SEGMENT_ID_HEADER = "x-fig-rsc-segment-id";
export const ROOT_ELEMENT_ID = "fig-root";
// Marks the DOM slot owned by the active `.server.tsx` route segment; the
// server may stream renderable HTML there, and the client mounts/refreshes the
// corresponding RSC payload in that slot.
export const RSC_SLOT_ATTR = "data-fig-rsc-slot";

export interface SerializedRouterState {
  // Per-route loader return values, keyed by route id, so the client hydrates
  // without re-running loaders on first paint.
  href: string;
  loaderData: Record<string, unknown>;
}

export interface SerializedRscSegment {
  // Segment id is separate from route id so the transport can grow from today's
  // single server-route leaf into nested route/layout segments later.
  id: string;
  routeId: string;
}

export interface SerializedRscFrame {
  chunk: string;
  id: string;
}

// Whether an RSC payload contains any client references (needs a client-reference
// resolver to render on the client).
