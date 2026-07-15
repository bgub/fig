import { type FigNode, isValidElement, type Props } from "@bgub/fig";
import { invalidChildError, isPortal } from "@bgub/fig/internal";

const EmptyHostTextContent = Symbol("fig.empty-host-text-content");
const NonTextHostContent = Symbol("fig.non-text-host-content");

type HostTextContent =
  | string
  | typeof EmptyHostTextContent
  | typeof NonTextHostContent;

export function hostTextContent(children: unknown): string | null {
  const text = hostTextContentPart(children as FigNode);
  return typeof text === "string" ? text : null;
}

export function hostChildren(props: Props): FigNode {
  if (!hasUnsafeHTML(props)) return props.children as FigNode;
  if (hasRenderableChild(props.children as FigNode)) {
    throw new Error("Host elements cannot have both unsafeHTML and children.");
  }
  return null;
}

export function hasUnsafeHTML(props: Props): boolean {
  return !emptyValue(props.unsafeHTML);
}

function hasRenderableChild(node: FigNode): boolean {
  if (Array.isArray(node)) return node.some(hasRenderableChild);
  return !emptyChild(node);
}

function emptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === false;
}

function emptyChild(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "boolean";
}

function hostTextContentPart(node: FigNode): HostTextContent {
  if (Array.isArray(node)) {
    let hasText = false;
    let text = "";

    for (const child of node) {
      const childText = hostTextContentPart(child);
      if (childText === NonTextHostContent) return NonTextHostContent;
      if (childText === EmptyHostTextContent) continue;

      hasText = true;
      text += childText;
    }

    return hasText ? text : EmptyHostTextContent;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return EmptyHostTextContent;
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (isValidElement(node) || isPortal(node)) return NonTextHostContent;

  throw invalidChildError(node);
}
