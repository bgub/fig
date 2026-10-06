import { assertSinglePart } from "./diagnostics.ts";
import { createPartCollection } from "./parts.ts";

/** Native top-layer synchronization shared by anchored popup widgets. */
export function createAnchoredPopup(
  registrationChanged: () => void,
  name: string,
) {
  const parts = createPartCollection<"anchor" | "popup">(registrationChanged);
  // The same host may own both roles. Collections key by host, so source
  // registrations must not replace the CSS anchor registration.
  const sources = createPartCollection<"source">(registrationChanged);

  function part(kind: "anchor" | "popup" | "source"): HTMLElement | undefined {
    const matches =
      kind === "source"
        ? sources.items()
        : parts.items().filter((entry) => entry.value === kind);
    assertSinglePart(matches, `${name} ${kind}`);
    return matches.at(-1)?.node;
  }

  function sync(open: boolean, anchorName: string): void {
    const anchor = part("anchor");
    anchor?.style.setProperty("anchor-name", anchorName);
    const popup = part("popup");
    if (popup === undefined) return;
    popup.style.setProperty("position-anchor", anchorName);
    if (typeof popup.showPopover !== "function") {
      popup.hidden = !open;
      return;
    }
    if (open === popup.matches(":popover-open")) return;
    // The source establishes the native popover tree even when a child popup
    // is mounted outside its parent popup (for example through a portal).
    if (open) {
      const source = part("source") ?? anchor;
      popup.showPopover(source === undefined ? undefined : { source });
    } else popup.hidePopover();
  }

  return {
    anchor: () => part("anchor"),
    bindAnchor: (node: HTMLElement, signal: AbortSignal) =>
      parts.bind(node, signal, "anchor"),
    bindPopup: (node: HTMLElement, signal: AbortSignal) =>
      parts.bind(node, signal, "popup"),
    bindSource: (node: HTMLElement, signal: AbortSignal) =>
      sources.bind(node, signal, "source"),
    popup: () => part("popup"),
    supported: () => typeof part("popup")?.showPopover === "function",
    sync,
  };
}

export function toggledOpen(event: Event): boolean | undefined {
  const state = (event as Event & { newState?: unknown }).newState;
  if (state === "open") return true;
  if (state === "closed") return false;
  return undefined;
}
