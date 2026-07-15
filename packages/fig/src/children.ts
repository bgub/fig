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

interface ChildCollector<TChild> {
  children: TChild[];
  mergeText: boolean;
}

// Child normalization shared by the reconciler and the server renderer.
// Adjacent text merging here MUST match on both sides: the server emits
// merged text nodes into HTML, and hydration matches them against the
// client's fiber children — divergence is a hydration mismatch.
export function collectChildren(node: FigNode): NormalizedChild[] {
  const collector: ChildCollector<NormalizedChild> = {
    children: [],
    mergeText: true,
  };
  collectChild(node, collector);
  return collector.children;
}

// Streaming keeps a pending thenable as its own child slot so the server can
// suspend only that slot after its parent has started writing. The ordinary
// collector reads it for the reconciler. Both collectors preserve a text seam
// on either side, so hydration sees the same fibers whether the promise was
// pending or already fulfilled when each renderer encountered it.
export function collectStreamingChildren(node: FigNode): StreamingChild[] {
  const collector: ChildCollector<StreamingChild> = {
    children: [],
    mergeText: true,
  };
  collectStreamingChild(node, collector);
  return collector.children;
}

function collectChild(
  node: unknown,
  collector: ChildCollector<NormalizedChild>,
): void {
  if (isThenable(node)) {
    collector.mergeText = false;
    collectChild(readThenable(node), collector);
    collector.mergeText = false;
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) collectChild(child, collector);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") return;

  if (typeof node === "string" || typeof node === "number") {
    appendTextChild(collector, String(node));
    return;
  }

  if (isValidElement(node) || isPortal(node)) {
    collector.children.push(node);
    collector.mergeText = true;
    return;
  }

  throw invalidChildError(node);
}

function collectStreamingChild(
  node: unknown,
  collector: ChildCollector<StreamingChild>,
): void {
  if (isThenable(node)) {
    collector.mergeText = false;
    collector.children.push(node as Extract<FigNode, Promise<unknown>>);
    collector.mergeText = false;
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) collectStreamingChild(child, collector);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") return;

  if (typeof node === "string" || typeof node === "number") {
    appendTextChild(collector, String(node));
    return;
  }

  if (isValidElement(node) || isPortal(node)) {
    collector.children.push(node);
    collector.mergeText = true;
    return;
  }

  throw invalidChildError(node);
}

function appendTextChild(
  collector: ChildCollector<StreamingChild>,
  text: string,
): void {
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
