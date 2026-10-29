import type { Container } from "./events.ts";

type FocusableElement = Element & { focus?: (options: FocusOptions) => void };

/** Preserve browser interaction state across the whole mutation phase. */
export function preserveFocus(container: Container, mutate: () => void): void {
  const document = container.ownerDocument ?? (container as Document);
  const containingRoot = container.getRootNode();
  let root: Document | ShadowRoot =
    containingRoot.nodeType === 11 && "host" in containingRoot
      ? (containingRoot as ShadowRoot)
      : document;
  if (!root.activeElement) root = document;
  let element = root.activeElement as FocusableElement | null;
  while (element?.shadowRoot?.activeElement) {
    root = element.shadowRoot;
    element = root.activeElement as FocusableElement;
  }
  // The document's default focus is not a user interaction to restore.
  if (
    !element ||
    element === document.body ||
    element === document.documentElement
  ) {
    mutate();
    return;
  }
  const focused = element;
  const selection = captureSelection(focused, root);
  try {
    mutate();
  } finally {
    if (focused.isConnected && focused.ownerDocument === document) {
      selection?.();
      // Selection repair can focus an outer editing host or fire a listener
      // that redirects focus. Make at most one explicit focus attempt afterward;
      // bindings and useBeforePaint apply their policy after restoration.
      if (root.activeElement !== focused && isVisible(focused))
        focused.focus?.({ preventScroll: true });
    }
  }
}

function captureSelection(
  element: Element,
  root: Document | ShadowRoot,
): (() => void) | null {
  if (element.localName === "input" || element.localName === "textarea") {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const {
      selectionStart: start,
      selectionEnd: end,
      selectionDirection: direction,
    } = input;
    if (start === null || end === null) return null;
    return () => {
      // Input type updates can make text selection unavailable during commit.
      if (
        input.selectionStart !== null &&
        (input.selectionStart !== start ||
          input.selectionEnd !== end ||
          input.selectionDirection !== direction) &&
        isVisible(input)
      ) {
        input.setSelectionRange(start, end, direction ?? undefined);
      }
    };
  }
  const selection = element.ownerDocument.getSelection();
  const range = selection && selectionRange(selection, root);
  if (
    !selection ||
    !range ||
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  )
    return null;
  // Text offsets belong to their text node; child offsets belong to the selected
  // child, not its old index. A live Range alone loses those identities on moves.
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const collapsed = range.collapsed;
  const resolveStart = captureBoundary(startContainer, startOffset, false);
  const resolveEnd = collapsed
    ? resolveStart
    : captureBoundary(endContainer, endOffset, true);
  const backward = isBackward(selection, range);
  return () => {
    const start = resolveStart();
    const end = collapsed ? start : resolveEnd();
    if (
      !start ||
      !end ||
      !element.contains(start.node) ||
      !element.contains(end.node)
    )
      return;
    const current = selectionRange(selection, root);
    // Reassert remapped boundaries even when the live Range agrees: browsers
    // can adjust the Range while retaining a stale selection for typing.
    if (
      start.node === startContainer &&
      start.offset === startOffset &&
      end.node === endContainer &&
      end.offset === endOffset &&
      current?.startContainer === start.node &&
      current.startOffset === start.offset &&
      current.endContainer === end.node &&
      current.endOffset === end.offset &&
      isBackward(selection, current) === backward
    )
      return;
    // setEnd collapses an inverted range. Do not turn reordered boundary
    // children into a new selection; shortened text may legitimately collapse.
    const ordered = element.ownerDocument.createRange();
    ordered.setStart(start.node, start.offset);
    ordered.setEnd(end.node, end.offset);
    if (
      ordered.startContainer !== start.node ||
      ordered.startOffset !== start.offset ||
      (!collapsed &&
        ordered.collapsed &&
        (startContainer.nodeType !== 3 || endContainer.nodeType !== 3))
    )
      return;
    if (!isVisible(element)) return;
    selection.setBaseAndExtent(
      backward ? end.node : start.node,
      backward ? end.offset : start.offset,
      backward ? start.node : end.node,
      backward ? start.offset : end.offset,
    );
  };
}

function selectionRange(
  selection: Selection,
  root: Document | ShadowRoot,
): AbstractRange | null {
  if (root.nodeType === 11 && selection.getComposedRanges) {
    return (
      selection.getComposedRanges({ shadowRoots: [root as ShadowRoot] })[0] ??
      null
    );
  }
  return selection.rangeCount ? selection.getRangeAt(0) : null;
}

function isBackward(selection: Selection, range: AbstractRange): boolean {
  return (
    selection.direction === "backward" ||
    (selection.direction === undefined &&
      selection.anchorNode === range.endContainer &&
      selection.anchorOffset === range.endOffset)
  );
}

function captureBoundary(
  node: Node,
  offset: number,
  end: boolean,
): () => { node: Node; offset: number } | null {
  if (node.nodeType === 3)
    return () => ({
      node,
      offset: Math.min(offset, node.nodeValue?.length ?? 0),
    });
  // Range starts and carets stick before the next child, or after the last one
  // at the end. Range ends stick after the previous child, or before the first.
  const after = offset > 0 && (end || offset === node.childNodes.length);
  const child = node.childNodes[offset - (after ? 1 : 0)];
  if (!child) return () => ({ node, offset: 0 });
  return () => {
    const parent = child.parentNode;
    if (!parent) return null;
    let index = after ? 1 : 0;
    for (
      let sibling = child.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    )
      index++;
    return { node: parent, offset: index };
  };
}

function isVisible(element: Element): boolean {
  return element.checkVisibility?.({ visibilityProperty: true }) !== false;
}
