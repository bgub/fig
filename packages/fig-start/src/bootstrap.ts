// Shared contract between the server handler (which serializes) and the client
// bootstrap (which reads) so router + data hydration stay in lockstep.

export const ROUTER_STATE_SCRIPT_ID = "__fig_start_state__";
export const DATA_SCRIPT_ID = "__fig_start_data__";
export const DATA_ENDPOINT_PATH = "/__fig/data";
export const DATA_FRAME_ATTR = "data-fig-data-frame";
export const DATA_STREAM_GLOBAL = "__figStartData";
export const PAYLOAD_SEGMENTS_SCRIPT_ID = "__fig_start_payload_segments__";
export const PAYLOAD_FRAME_ATTR = "data-fig-payload-frame";
export const PAYLOAD_STREAM_GLOBAL = "__figStartPayload";
// Options for @bgub/fig-server/payload's inline frame transport, shared by
// the server (bootstrap + frame scripts) and the client (queue reads).
export const PAYLOAD_FRAME_TRANSPORT = {
  attribute: PAYLOAD_FRAME_ATTR,
  globalName: PAYLOAD_STREAM_GLOBAL,
} as const;
export const CLIENT_REFERENCE_MODULES_GLOBAL = "__figStartClientReferences";
export const DEV_SERVER_UPDATE_EVENT = "fig-start:server-update";
export const PAYLOAD_ROUTE_ID_HEADER = "x-fig-payload-route-id";
export const PAYLOAD_SEGMENT_ID_HEADER = "x-fig-payload-segment-id";
export const ROOT_ELEMENT_ID = "fig-root";
// Marks the DOM slot owned by the active `.server.tsx` route segment; the
// server may stream renderable HTML there, and the client mounts/refreshes the
// corresponding payload in that slot.
export const PAYLOAD_SLOT_ATTR = "data-fig-payload-slot";

export interface SerializedRouterState {
  // Per-route loader return values, keyed by route id, so the client hydrates
  // without re-running loaders on first paint.
  href: string;
  loaderData: Record<string, unknown>;
}

export interface SerializedPayloadSegment {
  // Segment id is separate from route id so the transport can grow from today's
  // single server-route leaf into nested route/layout segments later.
  id: string;
  routeId: string;
}

export interface SerializedPayloadFrame {
  chunk: string;
  // Marks the segment's final frame: the client closes the byte stream it
  // feeds its payload decoder from, so end-of-stream semantics over frames
  // match a network response.
  end?: true;
  id: string;
}

export interface DevServerUpdateMessage {
  kind: "server";
  path: string;
}

// Whether a payload contains any client references (needs a client-reference
// resolver to render on the client).
