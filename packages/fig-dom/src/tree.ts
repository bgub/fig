export const htmlNamespace = "http://www.w3.org/1999/xhtml";
export const mathNamespace = "http://www.w3.org/1998/Math/MathML";
export const svgNamespace = "http://www.w3.org/2000/svg";

export function visitElementSubtree(
  node: Element | Text,
  visitor: (element: Element) => void,
): void {
  if (isElementNode(node)) visitor(node);

  for (const child of Array.from(node.childNodes ?? [])) {
    visitElementSubtree(child as Element | Text, visitor);
  }
}

export function isElementNode(node: unknown): node is Element {
  return (
    typeof node === "object" &&
    node !== null &&
    "nodeType" in node &&
    node.nodeType === 1
  );
}

export function elementName(node: unknown): string {
  if (!isElementNode(node)) return "";

  return "localName" in node && typeof node.localName === "string"
    ? node.localName.toLowerCase()
    : "tagName" in node && typeof node.tagName === "string"
      ? node.tagName.toLowerCase()
      : "";
}

export function isHtmlElement(element: Element): boolean {
  return (
    !("namespaceURI" in element) ||
    element.namespaceURI === null ||
    element.namespaceURI === htmlNamespace
  );
}

// Known limitation: the walk follows parentNode only and never hops shadow
// boundaries (a ShadowRoot's parentNode is null, and there is no `.host`
// fallback). Fig content rendered inside shadow trees is out of scope for
// root resolution, delegated dispatch, and replay targeting; register the
// in-shadow container as a portal target to route events explicitly.
export function parentOf(node: unknown): unknown {
  return typeof node === "object" && node !== null && "parentNode" in node
    ? node.parentNode
    : null;
}
