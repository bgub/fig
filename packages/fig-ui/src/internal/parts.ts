import type { MixinContext } from "@bgub/fig";
import { type Bind, composeBind, hostBinding } from "@bgub/fig-dom";
import { type Composite, type CompositeItem } from "./composite.ts";

/** Composes a widget's element binding after any the caller authored. */
export function bindPart(
  context: MixinContext,
  owner: object,
  bind: (node: HTMLElement, signal: AbortSignal) => void,
): Bind {
  return composeBind(
    context.props.bind,
    hostBinding(context, owner, (node, signal) => {
      if (node instanceof HTMLElement) bind(node, signal);
    }),
  );
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
    if (event.defaultPrevented) return;
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
 * so their state stays discoverable: explicit widget disability uses ARIA
 * instead of native `disabled`. Otherwise preserve the caller's native prop.
 */
export function triggerProps(
  context: MixinContext,
  options: { readonly disabled: boolean; readonly id?: string },
) {
  return {
    "aria-disabled": options.disabled ? "true" : undefined,
    "data-disabled": options.disabled ? "" : undefined,
    disabled: context.props.disabled,
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
