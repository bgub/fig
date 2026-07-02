import {
  DefaultLane,
  type HydrationTargetResult,
  InputContinuousLane,
  type Lane,
  runWithPriority,
  SyncLane,
} from "./priority.ts";
import { isElementNode, parentOf, visitElementSubtree } from "./tree.ts";

export type Container = Element | DocumentFragment;
export type EventOptions = Pick<
  AddEventListenerOptions,
  "capture" | "once" | "passive"
>;
export type EventCallback<E extends Event = Event> = (
  event: E,
  signal: AbortSignal,
) => void;
type Batch = <T>(callback: () => T) => T;
type RootScope = <T>(callback: () => T) => T;

export interface EventDescriptor<E extends Event = Event> {
  readonly $$typeof: symbol;
  readonly type: string;
  readonly callback: EventCallback<E>;
  readonly options?: EventOptions;
}

interface EventSlot {
  key: string;
  type: string;
  callback: EventCallback;
  options: Required<EventOptions>;
  controller: AbortController | null;
  element: Element | null;
  // A consumed `once` slot stays in the element's slot array as a tombstone:
  // slots are matched to descriptors by position, so splicing would tear
  // down and re-create every later sibling slot on the next render.
  fired: boolean;
  listener: EventListener | null;
  listenerTarget: Container | null;
  root: Container | null;
}

// Snapshot of one handler invocation, extracted before any handler runs: a
// re-entrant commit inside a handler may detach slots or swap callbacks
// mid-dispatch, and listeners subscribed when the event fired must still
// run exactly once with the fields they had at extraction.
interface DispatchEntry {
  callback: EventCallback;
  element: Element;
  root: Container | null;
  slot: EventSlot;
  type: string;
}

// Propagation is tracked per logical dispatch rather than on the event:
// a queued replay must not inherit cancelBubble state a third-party
// listener left on the spent native event.
interface PropagationState {
  baselineCancelBubble: boolean;
  immediateStopped: boolean;
  stopped: boolean;
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
  root: boolean;
  scope: RootScope | null;
}

const EventDescriptorSymbol = Symbol.for("fig.event");
const eventSlots = new WeakMap<Element, EventSlot[]>();
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
const discreteEvents = new Set([
  "beforeinput",
  "blur",
  "change",
  "click",
  "contextmenu",
  "dblclick",
  "focus",
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
const replayableEvents = new Set([
  "click",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
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
  "blur",
  "focus",
  "mouseenter",
  "mouseleave",
]);
// Non-bubbling events (other than focus/blur, which use capture delegation
// with Fig bubble semantics) attach directly to their element: a delegated
// bubble-phase root listener would never fire for them in a real browser.
const nonDelegatedEvents = new Set([
  "abort",
  "cancel",
  "canplay",
  "canplaythrough",
  "close",
  "durationchange",
  "emptied",
  "encrypted",
  "ended",
  "error",
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
  lane: Lane,
) => HydrationTargetResult;

export function setEventBatching(nextBatch: Batch): void {
  batch = nextBatch;
}

export function registerRoot(
  container: Container,
  hydrate?: HydrationCallback,
  scope?: RootScope,
): void {
  const record = containerRecord(container);
  record.root = true;
  if (scope !== undefined) record.scope = scope;
  if (hydrate === undefined) return;

  record.hydrate = hydrate;
  ensureHydrationListeners(container, record);
}

export function unregisterRoot(container: Container): void {
  const record = containerRecords.get(container);
  if (record === undefined) return;

  for (const [type, listener] of record.hydrationListeners ?? []) {
    container.removeEventListener(type, listener, { capture: true });
  }

  // Slot teardown normally empties this map before unmount finishes; sweep
  // whatever remains so no delegated listener outlives the root.
  for (const rootListener of record.listeners.values()) {
    container.removeEventListener(rootListener.type, rootListener.listener, {
      capture: rootListener.capture,
    });
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
      root: false,
      scope: null,
    };
    containerRecords.set(container, record);
  }
  return record;
}

export function on<K extends keyof HTMLElementEventMap>(
  type: K,
  callback: EventCallback<HTMLElementEventMap[K]>,
  options?: EventOptions,
): EventDescriptor<HTMLElementEventMap[K]>;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): EventDescriptor;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): EventDescriptor {
  return { $$typeof: EventDescriptorSymbol, type, callback, options };
}

export function updateEvents(element: Element, value: unknown): void {
  const slots = eventSlotsFor(element);
  const descriptors = eventDescriptors(value);
  const root = rootFor(element);
  const listenerTarget = listenerTargetFor(element);

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const options = normalizedOptions(descriptor.options);
    const key = eventKey(descriptor.type, options);
    const slot = slots[index];

    if (slot === undefined) {
      slots[index] = addEventSlot(
        element,
        root,
        listenerTarget,
        descriptor,
        options,
        key,
      );
    } else if (slot.key !== key) {
      removeEventSlot(slot);
      slots[index] = addEventSlot(
        element,
        root,
        listenerTarget,
        descriptor,
        options,
        key,
      );
    } else if (slot.callback !== descriptor.callback) {
      slot.callback = descriptor.callback as EventCallback;
    }
  }

  for (let index = slots.length - 1; index >= descriptors.length; index -= 1) {
    removeEventSlot(slots[index]);
  }

  slots.length = descriptors.length;
}

export function attachEventSubtree(node: Element | Text): void {
  visitElementSubtree(node, (element) => {
    const root = rootFor(element);
    const listenerTarget = listenerTargetFor(element);

    for (const slot of eventSlots.get(element) ?? []) {
      attachEventSlot(element, root, listenerTarget, slot);
    }
  });
}

export function removeEventSubtree(node: Element | Text): void {
  visitElementSubtree(node, (element) => {
    for (const slot of eventSlots.get(element) ?? []) removeEventSlot(slot);
    eventSlots.delete(element);
  });
}

export function rootFor(
  node: Element | Text | Comment | Container,
): Container | null {
  for (let current: unknown = node; current !== null; ) {
    if (isContainer(current)) {
      const record = containerRecords.get(current);
      if (record?.portalOwner != null) return record.portalOwner.root;
      if (record?.root === true) return current;
    }

    current = parentOf(current);
  }

  return null;
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

  for (let index = 0; index < queuedReplayableEvents.length; ) {
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
  descriptor: EventDescriptor,
  options: Required<EventOptions>,
  key: string,
): EventSlot {
  const slot: EventSlot = {
    key,
    type: descriptor.type,
    callback: descriptor.callback as EventCallback,
    options,
    controller: null,
    element: null,
    fired: false,
    listener: null,
    listenerTarget: null,
    root: null,
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
  if (listenerTargetFor(event.target) !== listenerTarget) return;
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

  const lane = eventLane(type);
  const result = runWithPriority(lane, () => hydrate(event.target, lane));
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

  const lane = eventLane(queued.type);
  return runWithPriority(lane, () => hydrate(queued.event.target, lane));
}

// Two-phase dispatch used where a single native listener stands in for both
// phases (focus-like capture delegation and queued replays). The bubble
// phase extracts after capture handlers ran, mirroring live DOM listener
// semantics; one propagation state spans both phases.
function dispatchTwoPhase(
  root: Container,
  listenerTarget: Container,
  type: string,
  passive: boolean | null,
  event: Event,
  replay = false,
): void {
  withPropagationState(event, replay, (state) => {
    invokeDispatches(
      extractDispatches(root, listenerTarget, type, true, passive, event),
      event,
      state,
    );

    if (state.immediateStopped || propagationStopped(event, state)) return;

    invokeDispatches(
      extractDispatches(root, listenerTarget, type, false, passive, event),
      event,
      state,
    );
  });
}

function dispatchReplayedEvent(queued: QueuedReplayableEvent): void {
  dispatchTwoPhase(
    queued.root,
    queued.listenerTarget ?? queued.root,
    queued.type,
    null,
    queued.event,
    true,
  );
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

    for (const slot of eventSlots.get(element) ?? []) {
      if (
        slot.fired ||
        slot.root !== root ||
        slot.type !== type ||
        slot.options.capture !== capture ||
        (passive !== null && slot.options.passive !== passive)
      ) {
        continue;
      }

      entries.push({
        callback: slot.callback,
        element,
        root: slot.root,
        slot,
        type: slot.type,
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
      if (currentElement !== null && propagationStopped(event, state)) return;
      currentElement = entry.element;
    }

    const slot = entry.slot;
    if (slot.options.once) {
      // A re-entrant dispatch from an earlier handler may have consumed it.
      if (slot.fired) continue;
      slot.fired = true;
      detachEventSlot(slot);
    }

    try {
      dispatchEventSlot(entry, event);
    } finally {
      // A slot detached mid-dispatch (removal or a consumed once) still ran
      // — it was subscribed when the event fired — but its signal must end
      // aborted per the abort-on-removal contract, even if the handler threw.
      if (slot.element === null && slot.listenerTarget === null) {
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
      runWithPriority(eventLane(entry.type), () => {
        withCurrentTarget(event, entry.element, (currentEvent) => {
          entry.callback(currentEvent, signal);
        });
      }),
    );
  });
}

function runWithRootScope<T>(root: Container | null, callback: () => T): T {
  const scope =
    root === null ? null : (containerRecords.get(root)?.scope ?? null);
  return scope === null ? callback() : scope(callback);
}

function abortEventSlot(slot: EventSlot): void {
  slot.controller?.abort();
  slot.controller = null;
}

function eventDescriptors(value: unknown): EventDescriptor[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value) && value.every(isEventDescriptor)) return value;
  throw new Error("The events prop must be an array of event descriptors.");
}

function isEventDescriptor(value: unknown): value is EventDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EventDescriptor).$$typeof === EventDescriptorSymbol
  );
}

function eventSlotsFor(element: Element): EventSlot[] {
  let slots = eventSlots.get(element);
  if (slots === undefined) {
    slots = [];
    eventSlots.set(element, slots);
  }
  return slots;
}

function attachEventSlot(
  element: Element,
  root: Container | null,
  listenerTarget: Container | null,
  slot: EventSlot,
): void {
  if (slot.fired) return;

  if (direct(slot.type)) {
    attachDirectEventSlot(element, slot);
  } else {
    attachDelegatedEventSlot(root, listenerTarget, slot);
  }
}

function attachDirectEventSlot(element: Element, slot: EventSlot): void {
  if (slot.element === element) return;

  detachEventSlot(slot);
  slot.element = element;
  slot.listener = (event) => {
    if (slot.fired) return;
    if (slot.options.once) {
      slot.fired = true;
      detachEventSlot(slot);
    }

    try {
      dispatchEventSlot(
        {
          callback: slot.callback,
          element,
          root: slot.root,
          slot,
          type: slot.type,
        },
        event,
      );
    } finally {
      if (slot.element === null && slot.listenerTarget === null) {
        abortEventSlot(slot);
      }
    }
  };
  element.addEventListener(slot.type, slot.listener, slot.options);
}

function attachDelegatedEventSlot(
  root: Container | null,
  listenerTarget: Container | null,
  slot: EventSlot,
): void {
  if (
    root === null ||
    listenerTarget === null ||
    (slot.root === root && slot.listenerTarget === listenerTarget)
  ) {
    return;
  }

  detachEventSlot(slot);
  slot.root = root;
  slot.listenerTarget = listenerTarget;

  acquireRootListener(
    root,
    listenerTarget,
    slot.type,
    rootListenerCapture(slot),
    slot.options.passive,
  );
}

function acquireRootListener(
  root: Container,
  listenerTarget: Container,
  type: string,
  capture: boolean,
  passive: boolean,
): void {
  const listeners = rootListenerMap(listenerTarget);
  const key = `${type}:${capture}:${passive}`;
  let rootListener = listeners.get(key);

  if (rootListener === undefined) {
    rootListener = {
      capture,
      count: 0,
      listener: (event) =>
        captureDelegated(type)
          ? dispatchFocusLikeEvent(root, listenerTarget, type, passive, event)
          : dispatchRootEvent(
              root,
              listenerTarget,
              type,
              capture,
              passive,
              event,
            ),
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

  listenerTarget.removeEventListener(rootListener.type, rootListener.listener, {
    capture: rootListener.capture,
  });
  listeners.delete(key);

  // The key died on this target: drop its mirrors from the portal targets.
  for (const portal of containerRecords.get(listenerTarget)?.portals ?? []) {
    releaseRootListener(portal, key);
  }
}

function detachEventSlot(slot: EventSlot): void {
  detachDirectEventSlot(slot);
  detachDelegatedEventSlot(slot);
}

function detachDirectEventSlot(slot: EventSlot): void {
  if (slot.element === null || slot.listener === null) return;

  slot.element.removeEventListener(slot.type, slot.listener, {
    capture: slot.options.capture,
  });
  slot.element = null;
  slot.listener = null;
}

function detachDelegatedEventSlot(slot: EventSlot): void {
  const listenerTarget = slot.listenerTarget;
  if (listenerTarget === null) return;

  slot.root = null;
  slot.listenerTarget = null;
  releaseRootListener(listenerTarget, rootListenerKey(slot));
}

function dispatchFocusLikeEvent(
  root: Container,
  listenerTarget: Container,
  type: string,
  passive: boolean,
  event: Event,
): void {
  if (listenerTargetFor(event.target) !== listenerTarget) return;
  if (hydrateForEvent(root, type, event) === "blocked") return;

  dispatchTwoPhase(root, listenerTarget, type, passive, event);
}

function rootListenerMap(root: Container): Map<string, RootListener> {
  return containerRecord(root).listeners;
}

function rootListenerKey(slot: EventSlot): string {
  return `${slot.type}:${rootListenerCapture(slot)}:${slot.options.passive}`;
}

function rootListenerCapture(slot: EventSlot): boolean {
  return captureDelegated(slot.type) || slot.options.capture;
}

function eventPath(
  root: Container,
  listenerTarget: Container,
  event: Event,
): Element[] {
  const composedPath = event.composedPath?.();

  if (composedPath !== undefined) {
    const index = composedPath.indexOf(listenerTarget);
    if (index !== -1) {
      return [
        ...composedPath.slice(0, index).filter(isElementNode),
        ...logicalPortalPath(root, listenerTarget),
      ];
    }
  }

  const path: Element[] = [];
  for (let current: unknown = event.target; current !== listenerTarget; ) {
    if (isElementNode(current)) path.push(current);
    current = parentOf(current);
    if (current === null) break;
  }

  return [...path, ...logicalPortalPath(root, listenerTarget)];
}

function logicalPortalPath(
  root: Container,
  listenerTarget: Container,
): Element[] {
  const owner = containerRecords.get(listenerTarget)?.portalOwner ?? null;
  if (owner === null || owner.root !== root) return [];

  const path: Element[] = [];
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

  return path;
}

function targetWithinRoot(
  root: Container,
  target: EventTarget | null,
): boolean {
  for (let current: unknown = target; current !== null; ) {
    if (current === root) return true;
    current = parentOf(current);
  }

  return false;
}

function listenerTargetFor(node: EventTarget | null): Container | null {
  for (let current: unknown = node; current !== null; ) {
    if (isContainer(current)) {
      const record = containerRecords.get(current);
      if (
        record !== undefined &&
        (record.portalOwner !== null || record.root)
      ) {
        return current;
      }
    }

    current = parentOf(current);
  }

  return null;
}

function withCurrentTarget<T>(
  event: Event,
  currentTarget: Element,
  callback: (event: Event) => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(event, "currentTarget");
  const changed = Reflect.defineProperty(event, "currentTarget", {
    configurable: true,
    value: currentTarget,
  });

  try {
    return callback(event);
  } finally {
    if (changed) {
      if (previous === undefined) {
        delete (event as unknown as { currentTarget?: EventTarget | null })
          .currentTarget;
      } else {
        Object.defineProperty(event, "currentTarget", previous);
      }
    }
  }
}

// Runs one logical dispatch with its own propagation state: the stop methods
// are patched (save/restore, so nested dispatches of other events are
// isolated) to record into the state while still calling the natives.
// Replays set `ignoreExistingCancelBubble`: a spent event's stale
// cancelBubble must not drop the replay, while a LIVE dispatch honors
// cancelBubble a sibling root listener's handler already set.
function withPropagationState<T>(
  event: Event,
  ignoreExistingCancelBubble: boolean,
  callback: (state: PropagationState) => T,
): T {
  const state: PropagationState = {
    baselineCancelBubble:
      ignoreExistingCancelBubble && event.cancelBubble === true,
    immediateStopped: false,
    stopped: false,
  };

  const restoreStop = patchEventMethod(event, "stopPropagation", () => {
    state.stopped = true;
  });
  const restoreImmediate = patchEventMethod(
    event,
    "stopImmediatePropagation",
    () => {
      state.stopped = true;
      state.immediateStopped = true;
    },
  );

  try {
    return callback(state);
  } finally {
    restoreImmediate();
    restoreStop();
  }
}

// Whether this logical dispatch stopped propagation: the state flags plus a
// direct `event.cancelBubble = true` assignment made during this dispatch —
// pre-existing cancelBubble (a spent event being replayed) is ignored.
function propagationStopped(event: Event, state: PropagationState): boolean {
  return (
    state.stopped ||
    (event.cancelBubble === true && !state.baselineCancelBubble)
  );
}

function patchEventMethod(
  event: Event,
  name: "stopImmediatePropagation" | "stopPropagation",
  onCall: () => void,
): () => void {
  const native = Reflect.get(event, name);
  if (typeof native !== "function") return () => undefined;

  const previous = Object.getOwnPropertyDescriptor(event, name);
  const changed = Reflect.defineProperty(event, name, {
    configurable: true,
    value() {
      onCall();
      native.call(event);
    },
  });

  return () => {
    if (!changed) return;
    if (previous === undefined) {
      delete (event as unknown as Record<string, unknown>)[name];
    } else {
      Object.defineProperty(event, name, previous);
    }
  };
}

function normalizedOptions(options: EventOptions = {}): Required<EventOptions> {
  return {
    capture: options.capture === true,
    once: options.once === true,
    passive: options.passive === true,
  };
}

function eventKey(type: string, options: Required<EventOptions>): string {
  return `${type}:${options.capture}:${options.once}:${options.passive}`;
}

function eventLane(type: string): Lane {
  if (discreteEvents.has(type)) return SyncLane;
  if (continuousEvents.has(type)) return InputContinuousLane;
  return DefaultLane;
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

function captureDelegated(type: string): boolean {
  return type === "blur" || type === "focus";
}

function isContainer(node: unknown): node is Container {
  return (
    typeof node === "object" &&
    node !== null &&
    "addEventListener" in node &&
    "childNodes" in node
  );
}
