import type { createAnchoredPopup } from "../internal/anchored-popup.ts";

export type PopoverRegistry = ReturnType<typeof createAnchoredPopup>;

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
