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

// Per-document mutex holding the currently running view transition. Client
// commits and inline streaming reveals both check it and chain on the
// previous transition's finished promise, so concurrent transitions never
// skip each other's animations or clobber temporarily applied names.
export const VIEW_TRANSITION_PENDING_PROPERTY = "__figViewTransition";

// Early-event capture: a tiny inline script at the top of a server-rendered
// document queues replayable events that fire before the client bundle
// executes. The first hydration root drains the queue, removes the capture
// listeners, and replays claimed events through the standard replay path.
// The event list must stay in sync with fig-dom's replayable set — a
// discrete replay forces synchronous hydration of its target, which is what
// makes pre-bundle clicks safe to honor.
export const HYDRATION_SKIP_ATTRIBUTE = "data-fig-hydration-skip";
export const EARLY_EVENT_QUEUE_PROPERTY = "__figEarlyEvents";
export const EARLY_EVENT_HANDLER_PROPERTY = "__figEarlyEventHandler";
export const REPLAYABLE_EVENT_TYPES = [
  "click",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
] as const;
