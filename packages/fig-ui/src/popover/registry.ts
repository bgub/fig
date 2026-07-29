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
    bindTrigger: popup.bindAnchor,
    noteToggle: popup.noteToggle,
    supported: popup.supported,
    sync: popup.sync,
  };
}
