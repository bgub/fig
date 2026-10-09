import { attachElementBind, detachElementBind } from "./bind.ts";
import { attachElementEvents, detachElementEvents } from "./events.ts";
import { visitElementSubtree } from "./tree.ts";

// Bind bookkeeping and event state attach and detach together when DOM moves in
// or out of the live tree; a single walk keeps that pairing unforgettable
// (a hook calling one without the other leaks signals or listeners) and
// halves the traversal per insertion/removal. Bind callbacks activate after
// commit-level restoration, once all event listeners are attached.

export function attachSubtree(node: Node): void {
  visitElementSubtree(node, (element) => {
    attachElementBind(element);
    attachElementEvents(element);
  });
}

export function detachSubtree(node: Node): void {
  visitElementSubtree(node, (element) => {
    detachElementBind(element);
    detachElementEvents(element);
  });
}
