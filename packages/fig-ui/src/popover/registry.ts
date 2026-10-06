import { createAnchoredPopup } from "../internal/anchored-popup.ts";

export type PopoverRegistry = ReturnType<typeof createPopoverRegistry>;

/**
 * Tracks the hosts of one popover and drives the native popover API.
 *
 * The platform owns the top layer, light dismiss, and Escape, and CSS anchor
 * positioning owns placement, so the registry only keeps the two elements in
 * step: it publishes the generated anchor name and reconciles visibility.
 */
export function createPopoverRegistry(registrationChanged: () => void) {
  const popup = createAnchoredPopup(registrationChanged, "popover");

  return {
    bindPopover: popup.bindPopup,
    bindSource: popup.bindSource,
    bindTrigger: popup.bindAnchor,
    supported: popup.supported,
    sync: popup.sync,
  };
}

// Widget composition can supply a native invoker without claiming CSS anchor
// placement or changing the public popover parts contract.
const sourceBindings = new WeakMap<object, PopoverRegistry["bindSource"]>();

export function registerPopoverSource(
  parts: object,
  bind: PopoverRegistry["bindSource"],
): void {
  sourceBindings.set(parts, bind);
}

export function bindPopoverSource(
  parts: object,
  node: HTMLElement,
  signal: AbortSignal,
): void {
  const bind = sourceBindings.get(parts);
  if (bind === undefined)
    throw new Error("Fig UI popover source must belong to usePopover().");
  bind(node, signal);
}
