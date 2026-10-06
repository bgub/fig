/** Move mounted DOM without discarding focus or native top-layer state. */
export function insertDomNode(
  parent: Node,
  child: Node,
  before: Node | null,
): void {
  if (
    child.parentNode === parent &&
    (child === before || child.nextSibling === before)
  )
    return;

  const target = parent as Node & {
    moveBefore?: (child: Node, before: Node | null) => void;
  };
  const owner = child.ownerDocument;
  const parentOwner = parent.nodeType === 9 ? parent : parent.ownerDocument;
  // Even atomic moves can reset live DOM ranges. Capture the selection before
  // either path so a focused contenteditable keeps its boundaries and direction.
  const active = owner?.activeElement;
  const focused =
    child.isConnected && active != null && child.contains(active)
      ? (active as Element & { focus?: (options: FocusOptions) => void })
      : null;
  const selection = focused ? owner?.getSelection() : null;
  const range =
    selection?.anchorNode != null &&
    selection.focusNode !== null &&
    focused?.contains(selection.anchorNode) &&
    focused.contains(selection.focusNode)
      ? {
          anchor: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focus: selection.focusNode,
          focusOffset: selection.focusOffset,
        }
      : null;
  if (
    child.parentNode !== null &&
    child.isConnected === parent.isConnected &&
    owner === parentOwner &&
    typeof target.moveBefore === "function"
  ) {
    // A separate live range follows the browser's automatic boundary changes,
    // but not selection edits made by connectedMoveCallback.
    const movedRange = range && selection?.getRangeAt(0).cloneRange();
    target.moveBefore(child, before);
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (
      movedRange &&
      (focused?.contains(movedRange.commonAncestorContainer) ||
        currentRange === null ||
        movedRange.compareBoundaryPoints(Range.START_TO_START, currentRange) !==
          0 ||
        movedRange.compareBoundaryPoints(Range.END_TO_END, currentRange) !== 0)
    )
      return;
  } else {
    parent.insertBefore(child, before);
  }
  // insertBefore detaches an existing node. Older browsers need focus restored
  // after that move, but a blur handler that chose another target wins.
  if (focused?.isConnected && owner?.activeElement === owner?.body) {
    focused.focus?.({ preventScroll: true });
  }
  if (
    range !== null &&
    focused?.isConnected &&
    owner?.activeElement === focused &&
    focused.contains(range.anchor) &&
    focused.contains(range.focus)
  ) {
    selection?.setBaseAndExtent(
      range.anchor,
      selectionOffset(range.anchor, range.anchorOffset),
      range.focus,
      selectionOffset(range.focus, range.focusOffset),
    );
  }
}

function selectionOffset(node: Node, offset: number): number {
  const length =
    node.nodeType === 3
      ? (node.nodeValue?.length ?? 0)
      : node.childNodes.length;
  return Math.min(offset, length);
}
