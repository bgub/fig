import { assertSinglePart } from "./diagnostics.ts";
import { createPartCollection } from "./parts.ts";

/** Native top-layer synchronization shared by anchored popup widgets. */
export function createAnchoredPopup(
  registrationChanged: () => void,
  name: string,
) {
  const parts = createPartCollection<"anchor" | "popup">(registrationChanged);
  let shown = false;

  function part(kind: "anchor" | "popup"): HTMLElement | undefined {
    const matches = parts.items().filter((entry) => entry.value === kind);
    assertSinglePart(matches, `${name} ${kind}`);
    return matches.at(-1)?.node;
  }

  function sync(open: boolean, anchorName: string): void {
    part("anchor")?.style.setProperty("anchor-name", anchorName);
    const popup = part("popup");
    if (popup === undefined) return;
    popup.style.setProperty("position-anchor", anchorName);
    if (typeof popup.showPopover !== "function") {
      popup.hidden = !open;
      shown = open;
      return;
    }
    if (open === shown) return;
    shown = open;
    if (open) popup.showPopover();
    else popup.hidePopover();
  }

  return {
    anchor: () => part("anchor"),
    bindAnchor: (node: HTMLElement, signal: AbortSignal) =>
      parts.bind(node, signal, "anchor"),
    bindPopup: (node: HTMLElement, signal: AbortSignal) =>
      parts.bind(node, signal, "popup"),
    noteToggle: (open: boolean) => {
      shown = open;
    },
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
