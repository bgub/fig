import {
  type FigElement,
  type FigNode,
  type FigPortal,
  isPortal,
  isValidElement,
} from "./element.ts";
import { isThenable } from "./thenables.ts";

// What normalization leaves behind: arrays are flattened, null/undefined/
// booleans are dropped, numbers are stringified into (merged) text, and a
// thenable keeps one stable child slot whose fulfilled value nests below it.
export type NormalizedChild =
  | FigElement<any>
  | FigPortal<any>
  | Extract<FigNode, Promise<unknown>>
  | string;

interface ChildCollector {
  children: NormalizedChild[];
  mergeText: boolean;
}

// Child normalization shared by the reconciler and the server renderer.
// Adjacent text merging here MUST match on both sides: the server emits
// merged text nodes into HTML, and hydration matches them against the
// client's fiber children — divergence is a hydration mismatch.
export function collectChildren(node: FigNode): NormalizedChild[] {
  return collectChildSequence(node);
}

function collectChildSequence(node: FigNode): NormalizedChild[] {
  const collector: ChildCollector = {
    children: [],
    mergeText: true,
  };
  collectChild(node, collector);
  return collector.children;
}

function collectChild(child: unknown, collector: ChildCollector): void {
  if (isThenable(child)) {
    // The slot itself prevents text on either side from merging. Its fiber
    // reads the thenable and reconciles the fulfilled node as nested content.
    collector.children.push(child as Extract<FigNode, Promise<unknown>>);
    collector.mergeText = true;
    return;
  }

  if (Array.isArray(child)) {
    for (const nested of child) collectChild(nested, collector);
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
