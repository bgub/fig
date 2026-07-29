import type { MixinContext } from "@bgub/fig";
import { type Bind, composeBind } from "@bgub/fig-dom";
import { type Composite, type CompositeItem, onAbort } from "./composite.ts";

export interface PartRegistration<Value> {
  readonly node: HTMLElement;
  readonly value: Value;
}

/** Composes a widget's element binding after any the caller authored. */
export function bindPart(
  context: MixinContext,
  bind: (node: HTMLElement, signal: AbortSignal) => void,
): Bind {
  return composeBind(context.props.bind, (node, signal) => {
    if (node instanceof HTMLElement) bind(node, signal);
  });
}

/**
 * Tracks one named element of a widget. A replacement binding commits before
 * the superseded signal aborts, so only the current element may clear the slot.
 */
export function createPartSlot(registrationChanged: () => void) {
  let current: HTMLElement | null = null;

  function bind(node: HTMLElement, signal: AbortSignal): void {
    current = node;
    registrationChanged();
    onAbort(signal, () => {
      if (current !== node) return;
      current = null;
      registrationChanged();
    });
  }

  return { bind, node: () => current };
}

/** Tracks every mounted host for a repeatable or cardinality-checked part. */
export function createPartCollection<Value>(registrationChanged: () => void) {
  const registrations = new Map<HTMLElement, PartRegistration<Value>>();

  function bind(node: HTMLElement, signal: AbortSignal, value: Value): void {
    const registration = { node, value };
    registrations.set(node, registration);
    registrationChanged();
    onAbort(signal, () => {
      if (registrations.get(node) !== registration) return;
      registrations.delete(node);
      registrationChanged();
    });
  }

  return { bind, items: () => [...registrations.values()] };
}

/**
 * How every widget reacts to a click on one of its items: targets the
 * container does not own are ignored, a disabled item cancels the default
 * action instead of activating, and only the primary button activates.
 */
export function activateOnClick(
  registry: Composite,
  activate: (item: CompositeItem, event: MouseEvent) => void,
): (event: MouseEvent) => void {
  return (event) => {
    const item = registry.itemAt(event.target);
    if (item === undefined) return;
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    if (event.button === 0) activate(item, event);
  };
}

/**
 * The host props every activating item shares. Disabled items stay focusable
 * so their state stays discoverable, so a native button deliberately does not
 * receive `disabled`.
 */
export function triggerProps(
  context: MixinContext,
  options: { readonly disabled: boolean; readonly id?: string },
) {
  return {
    "aria-disabled": options.disabled ? "true" : undefined,
    "data-disabled": options.disabled ? "" : undefined,
    disabled: context.type === "button" ? undefined : context.props.disabled,
    id: context.props.id ?? options.id,
    type:
      context.type === "button" ? (context.props.type ?? "button") : undefined,
  };
}

/** Points an ARIA relationship at an id, or removes it when there is none. */
export function setIdReference(
  node: HTMLElement,
  name: string,
  id: string | undefined,
): void {
  if (id === undefined || id === "") node.removeAttribute(name);
  else node.setAttribute(name, id);
}
