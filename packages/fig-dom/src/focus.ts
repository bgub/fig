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
      // Selection restoration can focus an outer editing host. Restore the
      // actual focused descendant afterward, without chasing callback choices.
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
  // Copy boundaries; a live Range follows removals and loses the old position.
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const backward = isBackward(selection, range);
  return () => {
    if (!element.contains(startContainer) || !element.contains(endContainer))
      return;
    const start = selectionOffset(startContainer, startOffset);
    const end = selectionOffset(endContainer, endOffset);
    const current = selectionRange(selection, root);
    if (
      current?.startContainer === startContainer &&
      current.startOffset === start &&
      current.endContainer === endContainer &&
      current.endOffset === end &&
      isBackward(selection, current) === backward
    )
      return;
    if (!isVisible(element)) return;
    selection.setBaseAndExtent(
      backward ? endContainer : startContainer,
      backward ? end : start,
      backward ? startContainer : endContainer,
      backward ? start : end,
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

function selectionOffset(node: Node, offset: number): number {
  const length =
    node.nodeType === 3
      ? (node.nodeValue?.length ?? 0)
      : node.childNodes.length;
  return Math.min(offset, length);
}

function isVisible(element: Element): boolean {
  return element.checkVisibility?.({ visibilityProperty: true }) !== false;
}
