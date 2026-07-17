import {
  EARLY_EVENT_HANDLER_PROPERTY,
  EARLY_EVENT_QUEUE_PROPERTY,
  REPLAYABLE_EVENT_TYPES,
} from "@bgub/fig/internal";
import {
  type EventPriority,
  type HydrationTargetResult,
  runWithEventPriority,
} from "@bgub/fig-reconciler";
import {
  type EventCallback,
  type NativeEventDescriptor,
} from "./event-descriptor.ts";
import {
  type PropagationState,
  withCurrentTarget,
  withPropagationState,
} from "./event-propagation.ts";
import { isElementNode, parentOf } from "./tree.ts";

export type Container = Element | DocumentFragment;
type Batch = <T>(callback: () => T) => T;
type RootRun = <T>(callback: () => T) => T;

interface EventSlot {
  attachment: EventAttachment | null;
  capture: boolean;
  callback: EventCallback;
  controller: AbortController | null;
  passive: boolean;
  slot: string;
  type: string;
}
type EventSlotList = EventSlot[];

type EventAttachment =
  | {
      element: Element;
      listener: EventListener;
      root: Container | null;
    }
  | { listenerTarget: Container; root: Container };

// Snapshot of one handler invocation, extracted before any handler runs: a
// re-entrant commit inside a handler may detach slots or swap callbacks
// mid-dispatch, and listeners subscribed when the event fired must still
// run exactly once with the fields they had at extraction.
interface DispatchEntry {
  callback: EventCallback;
  element: Element;
  root: Container | null;
  slot: EventSlot;
}

// type/capture/passive are stored rather than re-parsed from the listener
// key: event types may themselves contain the key separator (":").
interface RootListener {
  capture: boolean;
  count: number;
  listener: EventListener;
  passive: boolean;
  type: string;
}

interface QueuedReplayableEvent {
  event: Event;
  // The logical dispatch origin (a portal target or the root), captured
  // while the target is still attached so replays keep portal bubbling.
  listenerTarget: Container | null;
  root: Container;
  type: string;
}

interface PortalOwner {
  logicalParent: Container | Element;
  // The logical parent's listener target at registration time: the container
  // whose delegated keys this portal mirrors (an enclosing portal target, or
  // the root).
  parentTarget: Container;
  root: Container;
}

interface RootOptions {
  hydrate?: HydrationCallback;
  run: RootRun;
}

// One record per container that participates in event routing — a root, a
// portal target, or both roles' delegated listener host. Keeping every
// per-container datum here keeps registration, dispatch, and teardown
// reading one structure.
interface ContainerRecord {
  hydrate: HydrationCallback | null;
  hydrationListeners: Array<readonly [string, EventListener]> | null;
  listeners: Map<string, RootListener>;
  portalOwner: PortalOwner | null;
  // Portal targets whose logical parent resolves to this container: this
  // container's delegated listener keys mirror onto them (cascading down
  // nested portals) so portal-inner events always have a dispatch point for
  // logical bubbling, even when no portal-inner handler shares the key.
  portals: Set<Container> | null;
  // A non-null runner marks this container as a root. Portal-only records
  // leave it null.
  run: RootRun | null;
}

const eventSlots = new WeakMap<Element, EventSlotList>();
const containerRecords = new WeakMap<Container, ContainerRecord>();
// Keyed per (event, root): each root resolves selective hydration against
// its own tree, so an outer root's "none" must not shadow a nested root's
// "blocked". The inner WeakMap avoids retaining other roots' containers
// while a queued replayable event keeps the native event alive.
const eventHydrationResults = new WeakMap<
  Event,
  WeakMap<Container, HydrationTargetResult>
>();
const queuedReplayableEvents: QueuedReplayableEvent[] = [];
// Shared with the server's inline early-event-capture script: both sides
// must agree on which events queue for replay.
const replayableEvents = new Set<string>(REPLAYABLE_EVENT_TYPES);
const discreteEvents = new Set([
  "beforeinput",
  "blur",
  "change",
  "click",
  "contextmenu",
  "dblclick",
  "focus",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "submit",
  "touchend",
  "touchstart",
]);
const continuousEvents = new Set([
  "drag",
  "dragover",
  "mousemove",
  "pointermove",
  "scroll",
  "touchmove",
  "wheel",
]);
const hydrationEvents = new Set([
  ...discreteEvents,
  ...continuousEvents,
  "mouseenter",
  "mouseleave",
]);
// Non-bubbling events attach directly to their element with native
// semantics: a delegated bubble-phase root listener would never fire for
// them in a real browser. focus/blur included — the platform's bubbling
// variants are focusin/focusout, which delegate like any bubbling event, so
// Fig does not emulate bubbling focus the way React does.
const nonDelegatedEvents = new Set([
  "abort",
  "blur",
  "cancel",
  "canplay",
  "canplaythrough",
  "close",
  "durationchange",
  "emptied",
  "encrypted",
  "ended",
  "error",
  "focus",
  "invalid",
  "load",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "mouseenter",
  "mouseleave",
  "pause",
  "play",
  "playing",
  "pointerenter",
  "pointerleave",
  "progress",
  "ratechange",
  "resize",
  "scroll",
  "scrollend",
  "seeked",
  "seeking",
  "stalled",
  "suspend",
  "timeupdate",
  "toggle",
  "volumechange",
  "waiting",
]);
let batch: Batch = (callback) => callback();

type HydrationCallback = (
  target: EventTarget | null,
  priority: EventPriority,
) => HydrationTargetResult;

export function setEventBatching(nextBatch: Batch): void {
  batch = nextBatch;
}

export function registerRoot(container: Container, options: RootOptions): void {
  const record = containerRecord(container);
  record.run = options.run;
  if (options.hydrate === undefined) return;

  record.hydrate = options.hydrate;
  ensureHydrationListeners(container, record);
  adoptEarlyEvents(container);
}

type EarlyEventCarrier = Document & {
  [EARLY_EVENT_QUEUE_PROPERTY]?: Event[];
  [EARLY_EVENT_HANDLER_PROPERTY]?: EventListener;
};

// Events left over after each root claimed its own, kept per document so
// later-hydrating roots (multiple containers on one page) still find theirs.
const unclaimedEarlyEvents = new WeakMap<Document, Event[]>();

// The server's inline capture script queues replayable events that fired
// before this bundle executed. Adopt them into the standard replay queue:
// a discrete replay forces synchronous hydration of its target, so a
// pre-bundle click on server-rendered content is honored as soon as the
// drain microtask runs instead of being lost.
function adoptEarlyEvents(root: Container): void {
  const carrier = (root.ownerDocument ?? root) as EarlyEventCarrier;
  let unclaimed = unclaimedEarlyEvents.get(carrier);

  if (unclaimed === undefined) {
    const queue = carrier[EARLY_EVENT_QUEUE_PROPERTY];
    if (!Array.isArray(queue)) return;

    const handler = carrier[EARLY_EVENT_HANDLER_PROPERTY];
    if (
      typeof handler === "function" &&
      typeof carrier.removeEventListener === "function"
    ) {
      for (const type of REPLAYABLE_EVENT_TYPES) {
        carrier.removeEventListener(type, handler, true);
      }
    }
    delete carrier[EARLY_EVENT_QUEUE_PROPERTY];
    delete carrier[EARLY_EVENT_HANDLER_PROPERTY];

    unclaimed = queue;
    unclaimedEarlyEvents.set(carrier, unclaimed);
  }

  let claimed = false;
  for (let index = 0; index < unclaimed.length;) {
    const event = unclaimed[index];
    if (
      replayableEvents.has(event.type) &&
      targetWithinRoot(root, event.target)
    ) {
      unclaimed.splice(index, 1);
      queueReplayableEvent(root, event.type, event);
      claimed = true;
      continue;
    }
    index += 1;
  }

  if (claimed) queueMicrotask(replayQueuedEvents);
}

export function unregisterRoot(container: Container): void {
  const record = containerRecords.get(container);
  if (record === undefined) return;

  disableRootHydration(container);

  // Slot teardown normally empties this map before unmount finishes; sweep
  // whatever remains so no delegated listener outlives the root.
  for (const rootListener of record.listeners.values()) {
    container.removeEventListener(
      rootListener.type,
      rootListener.listener,
      rootListener.capture,
    );
  }

  // Portal teardown normally clears these during unmount; sweep stragglers
  // (nested portals hang off their parent target's record, so recurse).
  sweepPortals(container);

  containerRecords.delete(container);

  for (let index = queuedReplayableEvents.length - 1; index >= 0; index -= 1) {
    if (queuedReplayableEvents[index].root === container) {
      queuedReplayableEvents.splice(index, 1);
    }
  }
}

export function disableRootHydration(container: Container): void {
  const record = containerRecords.get(container);
  if (record === undefined || record.run === null) return;

  record.hydrate = null;
  for (const [type, listener] of record.hydrationListeners ?? []) {
    container.removeEventListener(type, listener, true);
  }
  record.hydrationListeners = null;
}

function sweepPortals(target: Container): void {
  for (const portal of containerRecords.get(target)?.portals ?? []) {
    sweepPortals(portal);
    removePortalContainer(portal);
  }
}

function containerRecord(container: Container): ContainerRecord {
  let record = containerRecords.get(container);
  if (record === undefined) {
    record = {
      hydrate: null,
      hydrationListeners: null,
      listeners: new Map(),
      portalOwner: null,
      portals: null,
      run: null,
    };
    containerRecords.set(container, record);
  }
  return record;
}

export function updateEvents(
  element: Element,
  descriptors: readonly NativeEventDescriptor[],
): void {
  const previousSlots = eventSlots.get(element) ?? [];
  if (previousSlots.length === 0 && descriptors.length === 0) return;
  const previousBySlot = new Map<string, EventSlot>();
  for (const slot of previousSlots) previousBySlot.set(slot.slot, slot);
  const nextSlots: EventSlot[] = [];
  let location: EventLocation | null = null;

  for (const descriptor of descriptors) {
    const capture = descriptor.options?.capture === true;
    const passive = descriptor.options?.passive === true;
    let slot = previousBySlot.get(descriptor.slot);
    previousBySlot.delete(descriptor.slot);

    if (slot === undefined) {
      location ??= eventLocationFor(element);
      slot = addEventSlot(
        element,
        location.root,
        location.listenerTarget,
        descriptor,
        capture,
        passive,
      );
    } else if (
      slot.type !== descriptor.type ||
      slot.capture !== capture ||
      slot.passive !== passive
    ) {
      location ??= eventLocationFor(element);
      removeEventSlot(slot);
      slot = addEventSlot(
        element,
        location.root,
        location.listenerTarget,
        descriptor,
        capture,
        passive,
      );
    } else if (slot.callback !== descriptor.callback) {
      slot.callback = descriptor.callback as EventCallback;
    }
    nextSlots.push(slot);
  }

  for (const slot of previousBySlot.values()) removeEventSlot(slot);
  if (nextSlots.length === 0) eventSlots.delete(element);
  else eventSlots.set(element, nextSlots);
}

export function attachElementEvents(element: Element): void {
  const slots = eventSlots.get(element);
  if (slots === undefined) return;
  const { listenerTarget, root } = eventLocationFor(element);

  for (const slot of slots) {
    attachEventSlot(element, root, listenerTarget, slot);
  }
}

export function detachElementEvents(element: Element): void {
  const slots = eventSlots.get(element);
  if (slots === undefined) return;
  for (const slot of slots) removeEventSlot(slot);
  eventSlots.delete(element);
}

// Derived from listenerTargetFor so the two walks cannot disagree about
// which container a node belongs to: the dispatch origin is the nearest
// registered container, and its root is itself or its portal owner's root.
export function rootFor(
  node: Element | Text | Comment | Container,
): Container | null {
  return eventLocationFor(node).root;
}

interface EventLocation {
  listenerTarget: Container | null;
  root: Container | null;
}

function eventLocationFor(
  node: Element | Text | Comment | Container,
): EventLocation {
  const listenerTarget = listenerTargetFor(node);
  if (listenerTarget === null) return { listenerTarget: null, root: null };

  // listenerTargetFor only returns containers with a live record; fail safe
  // (no root) if that invariant ever breaks rather than treating the node's
  // own container as a root.
  const record = containerRecords.get(listenerTarget);
  if (record === undefined) return { listenerTarget: null, root: null };

  return {
    listenerTarget,
    root:
      record.portalOwner?.root ?? (record.run !== null ? listenerTarget : null),
  };
}

export function registerPortalContainer(
  container: Container,
  root: Container,
  logicalParent: Container | Element,
): void {
  const record = containerRecord(container);
  const parentTarget = listenerTargetFor(logicalParent) ?? root;

  if (record.portalOwner !== null) {
    // Re-registration on a later commit: refresh the logical position; the
    // mirrors are already in place while the parent target is unchanged.
    if (
      record.portalOwner.root === root &&
      record.portalOwner.parentTarget === parentTarget
    ) {
      record.portalOwner = { logicalParent, parentTarget, root };
      return;
    }
    removePortalContainer(container);
  }

  record.portalOwner = {
    logicalParent,
    parentTarget,
    root,
  };

  const parentRecord = containerRecord(parentTarget);
  (parentRecord.portals ??= new Set()).add(container);
  // Mirror the logical parent target's active delegated keys (which already
  // include its own ancestors' mirrors) so events inside the portal have a
  // dispatch point for every handler along the logical ancestor chain.
  for (const mirrored of parentRecord.listeners.values()) {
    acquireRootListener(
      root,
      container,
      mirrored.type,
      mirrored.capture,
      mirrored.passive,
    );
  }
}

export function removePortalContainer(container: Container): void {
  const record = containerRecords.get(container);
  const owner = record?.portalOwner ?? null;
  if (record === undefined || owner === null) return;

  record.portalOwner = null;

  const parentRecord = containerRecords.get(owner.parentTarget);
  if (parentRecord === undefined) return;
  parentRecord.portals?.delete(container);
  for (const key of parentRecord.listeners.keys()) {
    releaseRootListener(container, key);
  }
}

export function replayQueuedEvents(): void {
  // Replays preserve the user's input order per root: a still-blocked entry
  // stalls later entries of ITS root only, so an independent root's
  // never-completing boundary cannot head-of-line block everyone else.
  const stalledRoots = new Set<Container>();

  for (let index = 0; index < queuedReplayableEvents.length;) {
    const queued = queuedReplayableEvents[index];

    // Liveness is checked against the logical dispatch origin: a portal
    // target lives outside the root container's DOM.
    const anchor = queued.listenerTarget ?? queued.root;
    if (!targetWithinRoot(anchor, queued.event.target)) {
      queuedReplayableEvents.splice(index, 1);
      continue;
    }

    // Attempt hydration even for stalled roots so later boundaries make
    // progress; only dispatch is withheld to keep ordering.
    if (hydrateQueuedEvent(queued) === "blocked") {
      stalledRoots.add(queued.root);
      index += 1;
      continue;
    }

    if (stalledRoots.has(queued.root)) {
      index += 1;
      continue;
    }

    queuedReplayableEvents.splice(index, 1);
    dispatchReplayedEvent(queued);
  }
}

function addEventSlot(
  element: Element,
  root: Container | null,
  listenerTarget: Container | null,
  descriptor: NativeEventDescriptor,
  capture: boolean,
  passive: boolean,
): EventSlot {
  const slot: EventSlot = {
    attachment: null,
    capture,
    callback: descriptor.callback as EventCallback,
    controller: null,
    passive,
    slot: descriptor.slot,
    type: descriptor.type,
  };
  attachEventSlot(element, root, listenerTarget, slot);
  return slot;
}

function removeEventSlot(slot: EventSlot): void {
  detachEventSlot(slot);
  abortEventSlot(slot);
}

function dispatchRootEvent(
  root: Container,
  listenerTarget: Container,
  type: string,
  capture: boolean,
  passive: boolean,
  event: Event,
): void {
  const targetListenerTarget = listenerTargetFor(event.target);
  if (targetListenerTarget !== listenerTarget) {
    const targetRecord =
      targetListenerTarget === null
        ? null
        : (containerRecords.get(targetListenerTarget) ?? null);
    if (targetRecord?.portalOwner?.root === root) return;
    if (!targetWithinRoot(listenerTarget, event.target)) return;
  }
  if (hydrateForEvent(root, type, event) === "blocked") return;

  const entries = extractDispatches(
    root,
    listenerTarget,
    type,
    capture,
    passive,
    event,
  );
  if (entries.length === 0) return;

  withPropagationState(event, false, (state) =>
    invokeDispatches(entries, event, state),
  );
}

function ensureHydrationListeners(
  root: Container,
  record: ContainerRecord,
): void {
  if (record.hydrationListeners !== null) return;
  record.hydrationListeners = [];

  for (const type of hydrationEvents) {
    const listener = (event: Event) => hydrateForEvent(root, type, event);
    record.hydrationListeners.push([type, listener]);
    root.addEventListener(type, listener, {
      capture: true,
      passive: passiveHydrationEvent(type),
    });
  }
}

function hydrateForEvent(
  root: Container,
  type: string,
  event: Event,
): HydrationTargetResult {
  const hydrate = containerRecords.get(root)?.hydrate ?? null;
  if (hydrate === null) return "none";

  let results = eventHydrationResults.get(event);
  const previousResult = results?.get(root);
  if (previousResult !== undefined) return previousResult;

  const priority = eventPriority(type);
  const result = runWithEventPriority(priority, () =>
    hydrate(event.target, priority),
  );
  if (results === undefined) {
    results = new WeakMap();
    eventHydrationResults.set(event, results);
  }
  results.set(root, result);

  // Queue only on the fresh computation: the capture hydration listener and
  // the delegated dispatch guard both land here for the same (event, root).
  if (result === "blocked" && replayableEvents.has(type)) {
    queueReplayableEvent(root, type, event);
  }

  return result;
}

function queueReplayableEvent(
  root: Container,
  type: string,
  event: Event,
): void {
  queuedReplayableEvents.push({
    event,
    listenerTarget: listenerTargetFor(event.target),
    root,
    type,
  });
}

function hydrateQueuedEvent(
  queued: QueuedReplayableEvent,
): HydrationTargetResult {
  const hydrate = containerRecords.get(queued.root)?.hydrate ?? null;
  if (hydrate === null) return "none";

  const priority = eventPriority(queued.type);
  return runWithEventPriority(priority, () =>
    hydrate(queued.event.target, priority),
  );
}

// Replays a queued event after selective hydration: the spent native event
// no longer propagates, so one synthetic dispatch stands in for both phases
// (`passive: null` matches every slot — no live root listener partitions
// them by key here). The bubble phase extracts after capture handlers ran,
// mirroring live DOM listener semantics; one propagation state spans both
// phases, ignoring the spent event's stale cancelBubble.
function dispatchReplayedEvent(queued: QueuedReplayableEvent): void {
  const { event, root, type } = queued;
  const listenerTarget = queued.listenerTarget ?? queued.root;

  withPropagationState(event, true, (state) => {
    invokeDispatches(
      extractDispatches(root, listenerTarget, type, true, null, event),
      event,
      state,
    );

    if (state.immediateStopped || state.stopped) return;

    invokeDispatches(
      extractDispatches(root, listenerTarget, type, false, null, event),
      event,
      state,
    );
  });
}

function extractDispatches(
  root: Container,
  listenerTarget: Container,
  type: string,
  capture: boolean,
  passive: boolean | null,
  event: Event,
): DispatchEntry[] {
  const path = eventPath(root, listenerTarget, event);
  const entries: DispatchEntry[] = [];
  const step = capture ? -1 : 1;

  for (
    let index = capture ? path.length - 1 : 0;
    index >= 0 && index < path.length;
    index += step
  ) {
    const element = path[index];
    const slots = eventSlots.get(element);
    if (slots === undefined) continue;

    for (const slot of slots) {
      const slotRoot = attachedRoot(slot);
      if (
        slotRoot !== root ||
        slot.type !== type ||
        slot.capture !== capture ||
        (passive !== null && slot.passive !== passive)
      ) {
        continue;
      }

      entries.push({
        callback: slot.callback,
        element,
        root: slotRoot,
        slot,
      });
    }
  }

  return entries;
}

function invokeDispatches(
  entries: DispatchEntry[],
  event: Event,
  state: PropagationState,
): void {
  let currentElement: Element | null = null;

  for (const entry of entries) {
    if (state.immediateStopped) return;

    // stopPropagation lets remaining handlers on the same element run and
    // skips every later element.
    if (entry.element !== currentElement) {
      if (currentElement !== null && state.stopped) return;
      currentElement = entry.element;
    }

    try {
      dispatchEventSlot(entry, event);
    } finally {
      // A slot detached mid-dispatch still ran — it was subscribed when the
      // event fired — but its signal must end aborted per the abort-on-removal
      // contract, even if the handler threw.
      const slot = entry.slot;
      if (slot.attachment === null) {
        abortEventSlot(slot);
      }
    }
  }
}

function dispatchEventSlot(entry: DispatchEntry, event: Event): void {
  const slot = entry.slot;
  abortEventSlot(slot);
  slot.controller = new AbortController();
  const signal = slot.controller.signal;

  batch(() => {
    runWithRootScope(entry.root, () =>
      runWithEventPriority(eventPriority(slot.type), () => {
        withCurrentTarget(event, entry.element, (currentEvent) => {
          entry.callback(currentEvent, signal);
        });
      }),
    );
  });
}

function runWithRootScope<T>(root: Container | null, callback: () => T): T {
  const run = root === null ? null : (containerRecords.get(root)?.run ?? null);
  return run === null ? callback() : run(callback);
}

function abortEventSlot(slot: EventSlot): void {
  slot.controller?.abort();
  slot.controller = null;
}

function attachEventSlot(
  element: Element,
  root: Container | null,
  listenerTarget: Container | null,
  slot: EventSlot,
): void {
  if (direct(slot.type)) {
    attachDirectEventSlot(element, root, slot);
  } else {
    attachDelegatedEventSlot(root, listenerTarget, slot);
  }
}

function attachDirectEventSlot(
  element: Element,
  root: Container | null,
  slot: EventSlot,
): void {
  // The root scopes dispatch (root.data.run and friends), same as the
  // delegated path. The first attach can run before insertion, when
  // rootFor() is still null, so a re-attach on the same element refreshes
  // the root without re-adding the DOM listener.
  const attachment = slot.attachment;
  if (attachment !== null) {
    if ("element" in attachment && attachment.element === element) {
      if (root !== null) attachment.root = root;
      return;
    }
    detachEventSlot(slot);
  }

  const listener: EventListener = (event) => {
    try {
      dispatchEventSlot(
        {
          callback: slot.callback,
          element,
          root: attachedRoot(slot),
          slot,
        },
        event,
      );
    } finally {
      if (slot.attachment === null) {
        abortEventSlot(slot);
      }
    }
  };
  slot.attachment = { element, listener, root };
  element.addEventListener(slot.type, listener, {
    capture: slot.capture,
    passive: slot.passive,
  });
}

function attachDelegatedEventSlot(
  root: Container | null,
  listenerTarget: Container | null,
  slot: EventSlot,
): void {
  if (root === null || listenerTarget === null) return;

  const attachment = slot.attachment;
  if (
    attachment !== null &&
    "listenerTarget" in attachment &&
    attachment.root === root &&
    attachment.listenerTarget === listenerTarget
  ) {
    return;
  }

  detachEventSlot(slot);
  slot.attachment = { listenerTarget, root };

  acquireRootListener(
    root,
    listenerTarget,
    slot.type,
    slot.capture,
    slot.passive,
  );
}

function acquireRootListener(
  root: Container,
  listenerTarget: Container,
  type: string,
  capture: boolean,
  passive: boolean,
): void {
  const listeners = containerRecord(listenerTarget).listeners;
  const key = `${type}:${capture}:${passive}`;
  let rootListener = listeners.get(key);

  if (rootListener === undefined) {
    rootListener = {
      capture,
      count: 0,
      listener: (event) =>
        dispatchRootEvent(root, listenerTarget, type, capture, passive, event),
      passive,
      type,
    };
    listenerTarget.addEventListener(type, rootListener.listener, {
      capture,
      passive,
    });
    listeners.set(key, rootListener);

    // A key newly active on a target mirrors onto its portal targets
    // (cascading through nested portals) so portal-inner events dispatch
    // through the logical tree for it.
    for (const portal of containerRecords.get(listenerTarget)?.portals ?? []) {
      acquireRootListener(root, portal, type, capture, passive);
    }
  }

  rootListener.count += 1;
}

function releaseRootListener(listenerTarget: Container, key: string): void {
  const listeners = containerRecords.get(listenerTarget)?.listeners;
  const rootListener = listeners?.get(key);
  if (listeners === undefined || rootListener === undefined) return;

  rootListener.count -= 1;
  if (rootListener.count > 0) return;

  listenerTarget.removeEventListener(
    rootListener.type,
    rootListener.listener,
    rootListener.capture,
  );
  listeners.delete(key);

  // The key died on this target: drop its mirrors from the portal targets.
  for (const portal of containerRecords.get(listenerTarget)?.portals ?? []) {
    releaseRootListener(portal, key);
  }
}

function detachEventSlot(slot: EventSlot): void {
  const attachment = slot.attachment;
  if (attachment === null) return;
  slot.attachment = null;

  if ("element" in attachment) {
    attachment.element.removeEventListener(
      slot.type,
      attachment.listener,
      slot.capture,
    );
  } else {
    releaseRootListener(
      attachment.listenerTarget,
      `${slot.type}:${slot.capture}:${slot.passive}`,
    );
  }
}

function attachedRoot(slot: EventSlot): Container | null {
  return slot.attachment?.root ?? null;
}

function eventPath(
  root: Container,
  listenerTarget: Container,
  event: Event,
): Element[] {
  const path: Element[] = [];
  const composedPath = event.composedPath?.();

  if (composedPath !== undefined) {
    const index = composedPath.indexOf(listenerTarget);
    if (index !== -1) {
      for (let pathIndex = 0; pathIndex < index; pathIndex += 1) {
        const node = composedPath[pathIndex];
        if (isElementNode(node)) path.push(node);
      }
      appendLogicalPortalPath(path, root, listenerTarget);
      return path;
    }
  }

  for (let current: unknown = event.target; current !== listenerTarget;) {
    if (isElementNode(current)) path.push(current);
    current = parentOf(current);
    if (current === null) break;
  }

  appendLogicalPortalPath(path, root, listenerTarget);
  return path;
}

function appendLogicalPortalPath(
  path: Element[],
  root: Container,
  listenerTarget: Container,
): void {
  const owner = containerRecords.get(listenerTarget)?.portalOwner ?? null;
  if (owner === null || owner.root !== root) return;

  let cursor: unknown = owner.logicalParent;

  while (cursor !== null && cursor !== root) {
    // A portal container in the chain (nested portals): continue from its
    // logical parent; the target element itself is not a logical ancestor.
    if (isContainer(cursor)) {
      const hop = containerRecords.get(cursor)?.portalOwner ?? null;
      if (hop !== null && hop.root === root) {
        cursor = hop.logicalParent;
        continue;
      }
    }

    if (isElementNode(cursor)) path.push(cursor);
    cursor = parentOf(cursor);
  }
}

function targetWithinRoot(
  root: Container,
  target: EventTarget | null,
): boolean {
  for (let current: unknown = target; current !== null;) {
    if (current === root) return true;
    current = parentOf(current);
  }

  return false;
}

function listenerTargetFor(node: EventTarget | null): Container | null {
  for (let current: unknown = node; current !== null;) {
    if (isContainer(current)) {
      const record = containerRecords.get(current);
      if (
        record !== undefined &&
        (record.portalOwner !== null || record.run !== null)
      ) {
        return current;
      }
    }

    current = parentOf(current);
  }

  return null;
}

function eventPriority(type: string): EventPriority {
  if (discreteEvents.has(type)) return "discrete";
  if (continuousEvents.has(type)) return "continuous";
  return "default";
}

function passiveHydrationEvent(type: string): boolean {
  // Hydration listeners never call preventDefault, so scroll-blocking touch
  // events can stay passive alongside the continuous set.
  return (
    continuousEvents.has(type) || type === "touchstart" || type === "touchend"
  );
}

function direct(type: string): boolean {
  return nonDelegatedEvents.has(type);
}

function isContainer(node: unknown): node is Container {
  return (
    typeof node === "object" &&
    node !== null &&
    "addEventListener" in node &&
    "childNodes" in node
  );
}
