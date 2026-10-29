/** Prefer native state-preserving moves; focus policy belongs to the commit. */
export function insertDomNode(
  parent: Document | DocumentFragment | Element,
  child: Node,
  before: Node | null,
): void {
  if (
    child.parentNode === parent &&
    (child === before || child.nextSibling === before)
  )
    return;

  const atomic =
    child.parentNode !== null &&
    typeof parent.moveBefore === "function" &&
    child.getRootNode({ composed: true }) ===
      parent.getRootNode({ composed: true });
  if (atomic) parent.moveBefore(child, before);
  else parent.insertBefore(child, before);
}
