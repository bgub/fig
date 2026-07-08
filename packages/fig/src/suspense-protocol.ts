// The Suspense streaming wire format shared by the server renderer (which
// emits these markers as HTML comments and interpolates them into the inline
// reveal script) and fig-dom (which parses them into dehydrated boundaries).
// Changing any value is a protocol change: server output and client parsing
// must move together.

export const SUSPENSE_MARKER_PREFIX = "fig:suspense:";
export const SUSPENSE_COMPLETED_MARKER = "fig:suspense:completed";
export const SUSPENSE_CLIENT_MARKER = "fig:suspense:client";
export const SUSPENSE_PENDING_PREFIX = "fig:suspense:pending:";
export const SUSPENSE_END_MARKER = "/fig:suspense";

// Hidden Activity content streams inside an inert template carrying this
// attribute; the client treats such templates as dehydrated boundaries.
export const ACTIVITY_TEMPLATE_ATTRIBUTE = "data-fig-activity";

export const VIEW_TRANSITION_NAME_ATTRIBUTE = "data-fig-vt-name";
export const VIEW_TRANSITION_CLASS_ATTRIBUTE = "data-fig-vt-class";
