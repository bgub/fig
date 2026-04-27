export function visitElementSubtree(
  node: Element | Text,
  visitor: (element: Element) => void,
): void {
  if (isElement(node)) visitor(node);

  for (const child of Array.from(node.childNodes ?? [])) {
    visitElementSubtree(child as Element | Text, visitor);
  }
}

export function isElement(node: unknown): node is Element {
  return typeof node === "object" && node !== null && "setAttribute" in node;
}

export function parentOf(node: unknown): unknown {
  return typeof node === "object" && node !== null && "parentNode" in node
    ? node.parentNode
    : null;
}
