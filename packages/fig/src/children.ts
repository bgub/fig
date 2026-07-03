import {
  type FigChild,
  type FigNode,
  isPortal,
  isValidElement,
} from "./element.ts";

// Child normalization shared by the reconciler and the server renderer.
// Adjacent text merging here MUST match on both sides: the server emits
// merged text nodes into HTML, and hydration matches them against the
// client's fiber children — divergence is a hydration mismatch.
export function collectChildren(node: FigNode): FigChild[] {
  const children: FigChild[] = [];
  collectChild(node, children);
  return children;
}

function collectChild(node: FigNode, children: FigChild[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectChild(child as FigNode, children);
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

  throw invalidChildError(node);
}

function appendTextChild(children: FigChild[], text: string): void {
  const previous = children.at(-1);

  if (typeof previous === "string" || typeof previous === "number") {
    children[children.length - 1] = `${previous}${text}`;
  } else {
    children.push(text);
  }
}

export function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, array, boolean, null, or undefined.`,
  );
}

export function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
}
