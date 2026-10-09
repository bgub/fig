import type { MixinContext } from "@bgub/fig";
import { mixinSlot } from "@bgub/fig/internal";
import { isEmptyPropValue } from "./tree.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

/** A callback owns work until its binding signal aborts. */
export type Bind<T extends Element = Element> = (
  node: T,
  signal: AbortSignal,
) => undefined;

/** Explicit callback spelling for APIs that also accept binding descriptions. */
export type BindCallback<T extends Element = Element> = Bind<T>;

/** A committed host behavior with identity independent of its configuration. */
export interface HostBinding<T extends Element = Element> {
  readonly owner: object;
  readonly slot: string;
  readonly update: BindCallback<T>;
}

/** Host prop value; arrays preserve each member's independent lifetime. */
export type Binding<T extends Element = Element> =
  | Bind<T>
  | HostBinding<T>
  | readonly (Binding<T> | false | null | undefined)[];

/**
 * Declare a behavior inside a mixin. Its callback runs on each committed
 * update, with the same signal until the owner/slot disappears, is replaced,
 * or Activity hides the host. Raw bind functions retain callback lifetimes.
 */
export function hostBinding<T extends Element = Element>(
  context: MixinContext,
  owner: object,
  update: BindCallback<T>,
): HostBinding<T> {
  return { owner, slot: mixinSlot(context), update };
}

interface BindSlot {
  callback: BindCallback;
  owner: object | undefined;
  controller: AbortController | null;
  strictRan: boolean;
}

const bindSlots = new WeakMap<Element, Map<string, BindSlot>>();
const suspendedBindElements = new WeakSet<Element>();

interface PendingBind {
  element: Element;
  key: string;
  update: boolean;
}

let pendingBinds: Map<BindSlot, PendingBind> | null = null;

/** Collect callbacks during mutation/restoration; activate after tree publication. */
export function deferBindCallbacks(
  mutate: () => void,
): (run: (element: Element, callback: () => void) => void) => void {
  const previous = pendingBinds;
  const pending = new Map<BindSlot, PendingBind>();
  pendingBinds = pending;
  try {
    mutate();
  } finally {
    pendingBinds = previous;
  }
  return (run) => {
    // Callback-triggered work must not join a surrounding mutation's queue.
    const surrounding = pendingBinds;
    pendingBinds = null;
    try {
      for (const [slot, { element, key, update }] of pending)
        run(element, () => runBindSlot(element, key, slot, update));
    } finally {
      pending.clear();
      pendingBinds = surrounding;
    }
  };
}

/** Compose callbacks into one callable binding with a shared lifetime. */
export function composeBind<T extends Element = Element>(
  ...binds: Array<Bind<T> | false | null | undefined>
): Bind<T> {
  const callbacks = binds.filter(
    (bind): bind is Bind<T> => typeof bind === "function",
  );
  return (node, signal) => {
    for (const bind of callbacks) bind(node, signal);
  };
}

export function updateBind(element: Element, value: unknown): void {
  const previous = bindSlots.get(element) ?? new Map<string, BindSlot>();
  const descriptors = new Map<
    string,
    { callback: BindCallback; owner: object | undefined }
  >();
  let position = 0;
  function collect(input: unknown): void {
    if (isEmptyPropValue(input)) {
      position++;
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (typeof input === "function") {
      descriptors.set(`callback:${position++}`, {
        callback: input as BindCallback,
        owner: undefined,
      });
      return;
    }
    if (isHostBinding(input)) {
      const key = `host:${input.slot}`;
      if (descriptors.has(key)) throw new Error("Duplicate host binding slot.");
      descriptors.set(key, { callback: input.update, owner: input.owner });
      return;
    }
    throw new Error("The bind prop must contain callbacks or host bindings.");
  }
  collect(value);
  // Retire removed owners before publishing any replacements.
  for (const [key, slot] of previous) {
    const next = descriptors.get(key);
    if (
      next === undefined ||
      next.owner !== slot.owner ||
      (next.owner === undefined && next.callback !== slot.callback)
    )
      removeBindSlot(slot);
  }
  const slots = new Map<string, BindSlot>();
  for (const [key, next] of descriptors) {
    const old = previous.get(key);
    const slot =
      old !== undefined && old.owner === next.owner
        ? old
        : {
            callback: next.callback,
            owner: next.owner,
            controller: null,
            strictRan: false,
          };
    slot.callback = next.callback;
    slots.set(key, slot);
  }
  // Publish every retained lifetime before user code can throw and trigger
  // teardown, including siblings whose update has not run yet.
  bindSlots.set(element, slots);
  for (const [key, slot] of slots)
    scheduleBindSlot(element, key, slot, slot.owner !== undefined);
  if (slots.size === 0) bindSlots.delete(element);
}

export function attachElementBind(element: Element): void {
  for (const [key, slot] of bindSlots.get(element) ?? [])
    scheduleBindSlot(element, key, slot, false);
}

export function suspendBind(element: Element): void {
  suspendedBindElements.add(element);
  for (const slot of bindSlots.get(element)?.values() ?? [])
    removeBindSlot(slot);
}

export function resumeBind(element: Element): void {
  suspendedBindElements.delete(element);
  for (const [key, slot] of bindSlots.get(element) ?? [])
    scheduleBindSlot(element, key, slot, false);
}

export function detachElementBind(element: Element): void {
  for (const slot of bindSlots.get(element)?.values() ?? [])
    removeBindSlot(slot);
  bindSlots.delete(element);
}

function scheduleBindSlot(
  element: Element,
  key: string,
  slot: BindSlot,
  update: boolean,
): void {
  if (slot.controller !== null && !update) return;
  if (pendingBinds !== null) {
    pendingBinds.set(slot, { element, key, update });
  } else {
    runBindSlot(element, key, slot, update);
  }
}

function runBindSlot(
  element: Element,
  key: string,
  slot: BindSlot,
  update: boolean,
): void {
  // A later mutation, visibility change, or callback can retire queued work.
  if (
    bindSlots.get(element)?.get(key) !== slot ||
    element.parentNode === null ||
    suspendedBindElements.has(element)
  )
    return;
  if (slot.controller !== null) {
    if (update) slot.callback(element, slot.controller.signal);
    return;
  }

  let runStrict = false;
  if (__DEV__) {
    // Marked before the callback so re-entrant attaches cannot re-enter the
    // strict cycle.
    runStrict = !slot.strictRan;
    slot.strictRan = true;
  }
  slot.controller = new AbortController();
  slot.callback(element, slot.controller.signal);
  if (__DEV__ && runStrict) {
    // Strict re-run: abort and re-invoke first-time binds so callbacks that
    // ignore their AbortSignal surface in development.
    removeBindSlot(slot);
    slot.controller = new AbortController();
    slot.callback(element, slot.controller.signal);
  }
}

function removeBindSlot(slot: BindSlot): void {
  const controller = slot.controller;
  slot.controller = null;
  controller?.abort();
}

function isHostBinding(value: unknown): value is HostBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "owner" in value &&
    (typeof value.owner === "object" || typeof value.owner === "function") &&
    value.owner !== null &&
    "slot" in value &&
    typeof value.slot === "string" &&
    "update" in value &&
    typeof value.update === "function"
  );
}
