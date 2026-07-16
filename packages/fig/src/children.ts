import {
  type FigElement,
  type FigNode,
  type FigPortal,
  isPortal,
  isValidElement,
} from "./element.ts";
import { isThenable, readThenable } from "./thenables.ts";

// What normalization leaves behind: arrays are flattened, null/undefined/
// booleans are dropped, and numbers are stringified into (merged) text.
export type NormalizedChild = FigElement<any> | FigPortal<any> | string;
export type StreamingChild =
  | NormalizedChild
  | Extract<FigNode, Promise<unknown>>;

interface ChildCollector {
  children: StreamingChild[];
  mergeText: boolean;
}

// Child normalization shared by the reconciler and the server renderer.
// Adjacent text merging here MUST match on both sides: the server emits
// merged text nodes into HTML, and hydration matches them against the
// client's fiber children — divergence is a hydration mismatch.
export function collectChildren(node: FigNode): NormalizedChild[] {
  return collectChildSequence(node, "settled");
}

// Streaming keeps a pending thenable as its own child slot so the server can
// suspend only that slot after its parent has started writing. The ordinary
// collector reads it for the reconciler. Both collectors preserve a text seam
// on either side, so hydration sees the same fibers whether the promise was
// pending or already fulfilled when each renderer encountered it.
export function collectStreamingChildren(node: FigNode): StreamingChild[] {
  return collectChildSequence(node, "streaming");
}

function collectChildSequence(
  node: FigNode,
  mode: "settled",
): NormalizedChild[];
function collectChildSequence(
  node: FigNode,
  mode: "streaming",
): StreamingChild[];
function collectChildSequence(
  node: FigNode,
  mode: "settled" | "streaming",
): StreamingChild[] {
  const collector: ChildCollector = {
    children: [],
    mergeText: true,
  };
  collectChild(node, collector, mode === "streaming");
  return collector.children;
}

function collectChild(
  child: unknown,
  collector: ChildCollector,
  streaming: boolean,
): void {
  if (isThenable(child)) {
    if (streaming) {
      // The promise slot itself prevents text on either side from merging.
      collector.children.push(child as Extract<FigNode, Promise<unknown>>);
    } else {
      collector.mergeText = false;
      collectChild(readThenable(child), collector, false);
      collector.mergeText = false;
    }
    return;
  }

  if (Array.isArray(child)) {
    for (const nested of child) collectChild(nested, collector, streaming);
    return;
  }

  if (child === null || child === undefined || typeof child === "boolean") {
    return;
  }

  if (typeof child === "string" || typeof child === "number") {
    appendTextChild(collector, String(child));
    return;
  }

  if (isValidElement(child) || isPortal(child)) {
    collector.children.push(child);
    collector.mergeText = true;
    return;
  }

  throw invalidChildError(child);
}

function appendTextChild(collector: ChildCollector, text: string): void {
  const previous = collector.children.at(-1);

  if (collector.mergeText && typeof previous === "string") {
    collector.children[collector.children.length - 1] = `${previous}${text}`;
  } else {
    collector.children.push(text);
  }
  collector.mergeText = true;
}

export function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, promise, array, boolean, null, or undefined.`,
  );
}

export function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
}
