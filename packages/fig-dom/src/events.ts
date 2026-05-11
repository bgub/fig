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
  listener: EventListener | null;
  listenerTarget: Container | null;
  root: Container | null;
}

interface RootListener {
  count: number;
  listener: EventListener;
}

interface QueuedReplayableEvent {
  event: Event;
  root: Container;
  type: string;
}

interface PortalOwner {
  logicalParent: Container | Element;
  root: Container;
}

const EventDescriptorSymbol = Symbol.for("fig.event");
const eventSlots = new WeakMap<Element, EventSlot[]>();
const portalOwners = new WeakMap<Container, PortalOwner>();
const rootContainers = new WeakSet<Container>();
const rootListeners = new WeakMap<Container, Map<string, RootListener>>();
const rootHydrationCallbacks = new WeakMap<Container, HydrationCallback>();
const rootsWithHydrationListeners = new WeakSet<Container>();
const immediatePropagationStopped = new WeakSet<Event>();
const eventHydrationResults = new WeakMap<Event, HydrationTargetResult>();
const queuedReplayableEvents: QueuedReplayableEvent[] = [];
const discreteEvents = new Set([
  "beforeinput",
  "change",
  "click",
  "input",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "submit",
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
): void {
  rootContainers.add(container);
  if (hydrate === undefined) return;

  rootHydrationCallbacks.set(container, hydrate);
  ensureHydrationListeners(container);
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
      const owner = portalOwners.get(current);
      if (owner !== undefined) return owner.root;
      if (rootContainers.has(current)) return current;
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
  portalOwners.set(container, {
    logicalParent,
    root,
  });
}

export function removePortalContainer(container: Container): void {
  portalOwners.delete(container);
}

export function replayQueuedEvents(root: Container): void {
  for (let index = 0; index < queuedReplayableEvents.length; ) {
    const queued = queuedReplayableEvents[index];

    if (queued.root !== root) {
      index += 1;
      continue;
    }

    if (!targetWithinRoot(root, queued.event.target)) {
      queuedReplayableEvents.splice(index, 1);
      continue;
    }

    if (hydrateQueuedEvent(queued) === "blocked") {
      index += 1;
      continue;
    }

    queuedReplayableEvents.splice(index, 1);
    dispatchReplayedEvent(root, queued.type, queued.event);
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

  withStopImmediatePropagation(event, () => {
    dispatchRootEventPath(root, listenerTarget, type, capture, passive, event);
  });
}

function ensureHydrationListeners(root: Container): void {
  if (rootsWithHydrationListeners.has(root)) return;
  rootsWithHydrationListeners.add(root);

  for (const type of hydrationEvents) {
    const listener = (event: Event) => hydrateForEvent(root, type, event);
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
  const hydrate = rootHydrationCallbacks.get(root);
  if (hydrate === undefined) return "none";

  const previousResult = eventHydrationResults.get(event);
  if (previousResult !== undefined) return previousResult;

  const lane = eventLane(type);
  const result = runWithPriority(lane, () => hydrate(event.target, lane));
  eventHydrationResults.set(event, result);

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
    root,
    type,
  });
}

function hydrateQueuedEvent(
  queued: QueuedReplayableEvent,
): HydrationTargetResult {
  const hydrate = rootHydrationCallbacks.get(queued.root);
  if (hydrate === undefined) return "none";

  const lane = eventLane(queued.type);
  return runWithPriority(lane, () => hydrate(queued.event.target, lane));
}

function dispatchReplayedEvent(
  root: Container,
  type: string,
  event: Event,
): void {
  withStopImmediatePropagation(event, () => {
    dispatchRootEventPath(root, root, type, true, null, event);
    if (!event.cancelBubble) {
      dispatchRootEventPath(root, root, type, false, null, event);
    }
  });
}

function dispatchRootEventPath(
  root: Container,
  listenerTarget: Container,
  type: string,
  capture: boolean,
  passive: boolean | null,
  event: Event,
): void {
  const path = eventPath(root, listenerTarget, event);
  const step = capture ? -1 : 1;
  let index = capture ? path.length - 1 : 0;

  while (index >= 0 && index < path.length) {
    if (
      dispatchRootEventAtElement(
        root,
        type,
        capture,
        passive,
        event,
        path[index],
      )
    ) {
      return;
    }
    index += step;
  }
}

function dispatchRootEventAtElement(
  root: Container,
  type: string,
  capture: boolean,
  passive: boolean | null,
  event: Event,
  element: Element,
): boolean {
  const slots = eventSlots.get(element);
  if (slots === undefined) return false;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (
      slot.root !== root ||
      slot.type !== type ||
      slot.options.capture !== capture ||
      (passive !== null && slot.options.passive !== passive)
    ) {
      continue;
    }

    index = detachOnceEventSlot(element, slot, slots, index);
    dispatchEventSlotWithCleanup(element, slot, event);

    if (immediatePropagationStopped.has(event)) return true;
  }

  return event.cancelBubble;
}

function dispatchEventSlot(
  element: Element,
  slot: EventSlot,
  event: Event,
): void {
  abortEventSlot(slot);
  slot.controller = new AbortController();
  const signal = slot.controller.signal;

  batch(() => {
    runWithPriority(eventLane(slot.type), () => {
      withCurrentTarget(event, element, (currentEvent) => {
        slot.callback(currentEvent, signal);
      });
    });
  });
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
    detachOnceEventSlot(element, slot);
    dispatchEventSlotWithCleanup(element, slot, event);
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

  const listeners = rootListenerMap(listenerTarget);
  const key = rootListenerKey(slot);
  let rootListener = listeners.get(key);

  if (rootListener === undefined) {
    const capture = rootListenerCapture(slot);
    const { passive } = slot.options;
    const { type } = slot;
    rootListener = {
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
    };
    listenerTarget.addEventListener(type, rootListener.listener, {
      capture,
      passive,
    });
    listeners.set(key, rootListener);
  }

  rootListener.count += 1;
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
  const key = rootListenerKey(slot);
  const listeners = rootListeners.get(listenerTarget);
  const rootListener = listeners?.get(key);

  if (rootListener === undefined) return;

  rootListener.count -= 1;

  if (rootListener.count === 0) {
    listenerTarget.removeEventListener(slot.type, rootListener.listener, {
      capture: rootListenerCapture(slot),
    });
    listeners.delete(key);
  }
}

function removeElementSlot(
  element: Element,
  slots: EventSlot[],
  index: number,
): void {
  removeEventSlot(slots[index]);
  slots.splice(index, 1);
  if (slots.length === 0) eventSlots.delete(element);
}

function detachOnceEventSlot(
  element: Element,
  slot: EventSlot,
  slots = eventSlots.get(element),
  index = slots?.indexOf(slot) ?? -1,
): number {
  if (!slot.options.once || slots === undefined || index === -1) return index;
  removeElementSlot(element, slots, index);
  return index - 1;
}

function dispatchEventSlotWithCleanup(
  element: Element,
  slot: EventSlot,
  event: Event,
): void {
  try {
    dispatchEventSlot(element, slot, event);
  } finally {
    if (slot.options.once) abortEventSlot(slot);
  }
}

function dispatchFocusLikeEvent(
  root: Container,
  listenerTarget: Container,
  type: string,
  passive: boolean,
  event: Event,
): void {
  dispatchRootEvent(root, listenerTarget, type, true, passive, event);
  if (!event.cancelBubble) {
    dispatchRootEvent(root, listenerTarget, type, false, passive, event);
  }
}

function rootListenerMap(root: Container): Map<string, RootListener> {
  let listeners = rootListeners.get(root);
  if (listeners === undefined) {
    listeners = new Map();
    rootListeners.set(root, listeners);
  }
  return listeners;
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
  const owner = portalOwners.get(listenerTarget);
  if (owner === undefined || owner.root !== root) return [];

  const path: Element[] = [];
  for (
    let current: unknown = owner.logicalParent;
    current !== null && current !== root;
    current = parentOf(current)
  ) {
    if (isElementNode(current)) path.push(current);
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

function listenerTargetFor(
  node: Element | Text | Comment | Container,
): Container | null {
  for (let current: unknown = node; current !== null; ) {
    if (isContainer(current)) {
      if (portalOwners.has(current) || rootContainers.has(current)) {
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

function withStopImmediatePropagation<T>(event: Event, callback: () => T): T {
  const stopImmediatePropagation = event.stopImmediatePropagation;
  if (typeof stopImmediatePropagation !== "function") return callback();

  const previous = Object.getOwnPropertyDescriptor(
    event,
    "stopImmediatePropagation",
  );
  const changed = Reflect.defineProperty(event, "stopImmediatePropagation", {
    configurable: true,
    value() {
      immediatePropagationStopped.add(event);
      stopImmediatePropagation.call(event);
    },
  });

  try {
    return callback();
  } finally {
    if (changed) {
      if (previous === undefined) {
        delete (event as unknown as { stopImmediatePropagation?: () => void })
          .stopImmediatePropagation;
      } else {
        Object.defineProperty(event, "stopImmediatePropagation", previous);
      }
    }
  }
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
  return continuousEvents.has(type);
}

function direct(type: string): boolean {
  return type === "mouseenter" || type === "mouseleave" || type === "scroll";
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
