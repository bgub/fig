import { toggledOpen } from "./anchored-popup.ts";

/** Focus ownership for popups that move DOM focus into their content. */
export function createPopupFocus(
  popup: () => HTMLElement | null,
  trigger: () => HTMLElement | null,
) {
  let wasOpen = false;
  let closingFocus: Element | undefined;
  let nativeLoss = false;
  function containsFocus(): boolean {
    const node = popup();
    return node?.contains(node.ownerDocument.activeElement) === true;
  }
  return {
    closingFrom(origin?: Element): void {
      closingFocus = origin;
    },
    beforeToggle: (event: Event): void => {
      if (event.target === event.currentTarget) {
        nativeLoss = toggledOpen(event) === false && containsFocus();
      }
    },
    sync(open: boolean, initialFocus: () => void): void {
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) {
        closingFocus = undefined;
        nativeLoss = false;
        initialFocus();
        return;
      }
      const node = trigger();
      const document = node?.ownerDocument;
      const active = document?.activeElement;
      // Firefox can clear focus during native dismissal. Never override an
      // intentional move to another control, including an onSelect callback.
      if (
        containsFocus() ||
        (nativeLoss && active === document?.body) ||
        (closingFocus !== undefined && closingFocus === active)
      )
        node?.focus();
      closingFocus = undefined;
      nativeLoss = false;
    },
  };
}
