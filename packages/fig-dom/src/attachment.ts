import { attachElementBind, detachElementBind } from "./bind.ts";
import { attachElementEvents, detachElementEvents } from "./events.ts";
import { visitElementSubtree } from "./tree.ts";

// Bind and event state always attach and detach together when DOM moves in
// or out of the live tree; a single walk keeps that pairing unforgettable
// (a hook calling one without the other leaks signals or listeners) and
// halves the traversal per insertion/removal.

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
