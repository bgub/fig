// Shared contract between the server handler (which serializes) and the client
// bootstrap (which reads) so router + data hydration stay in lockstep.

export const ROUTER_STATE_SCRIPT_ID = "__fig_start_state__";
export const DATA_SCRIPT_ID = "__fig_start_data__";
export const RSC_PAYLOAD_SCRIPT_ID = "__fig_start_rsc__";
export const RSC_SEGMENTS_SCRIPT_ID = "__fig_start_rsc_segments__";
export const RSC_FRAME_ATTR = "data-fig-rsc-frame";
export const RSC_STREAM_GLOBAL = "__figStartRSC";
export const RSC_ROUTE_ID_HEADER = "x-fig-rsc-route-id";
export const RSC_SEGMENT_ID_HEADER = "x-fig-rsc-segment-id";
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
  // Legacy buffered payload shape. New server output streams segment frames, but
  // the client keeps this path so older documents still hydrate.
  routeId: string;
  rows: string;
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
export function hasClientReferences(rows: string): boolean {
  return rows.includes('"tag":"client"');
}
