import {
  type AwaitedFigNode,
  type FigElement,
  type FigNode,
  type FigPortal,
  isPortal,
  isValidElement,
} from "./element.ts";
import { isThenable } from "./thenables.ts";

// What normalization leaves behind: arrays are flattened, null/undefined/
// booleans are dropped, and numbers are stringified into (merged) text.
/** Describes normalized child. */
export type NormalizedChild =
  | FigElement<any>
  | FigPortal<any>
  | PromiseLike<AwaitedFigNode>
  | string;

// Child normalization shared by the reconciler and the server renderer.
// Adjacent text merging here MUST match on both sides: the server emits
// merged text nodes into HTML, and hydration matches them against the
// client's fiber children — divergence is a hydration mismatch.
/** Collect children. */
export function collectChildren(node: FigNode): NormalizedChild[] {
  if (Array.isArray(node)) return collectArrayChildren(node);

  const children: NormalizedChild[] = [];
  collectChild(node, children);
  return children;
}

function collectArrayChildren(children: FigNode[]): NormalizedChild[] {
  let previousWasText = false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (typeof child === "string") {
      if (child !== "" && !previousWasText) {
        previousWasText = true;
        continue;
      }
    } else {
      previousWasText = false;
      if (
        !Array.isArray(child) &&
        child !== null &&
        child !== undefined &&
        typeof child !== "boolean" &&
        typeof child !== "number"
      ) {
        if (isValidElement(child) || isPortal(child) || isThenable(child)) {
          continue;
        }
        throw invalidChildError(child);
      }
    }

    const normalized = children.slice(0, index) as NormalizedChild[];
    for (; index < children.length; index += 1) {
      collectChild(children[index], normalized);
    }
    return normalized;
  }
  return children as NormalizedChild[];
}

function collectChild(node: FigNode, children: NormalizedChild[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectChild(child, children);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") return;

  if (typeof node === "string" || typeof node === "number") {
    appendTextChild(children, String(node));
    return;
  }

  if (isValidElement(node) || isPortal(node)) {
    children.push(node);
    return;
  }

  if (isThenable(node)) {
    children.push(node);
    return;
  }

  throw invalidChildError(node);
}

function appendTextChild(children: NormalizedChild[], text: string): void {
  if (text === "") return;

  const previous = children.at(-1);

  if (typeof previous === "string") {
    children[children.length - 1] = `${previous}${text}`;
  } else {
    children.push(text);
  }
}

/** Invalid child error. */
export function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, promise, array, boolean, null, or undefined.`,
  );
}

/** Describes invalid child. */
export function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
}
