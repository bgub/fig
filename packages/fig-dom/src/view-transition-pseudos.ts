import type { ViewTransitionSurface } from "@bgub/fig";
import type { ViewTransitionSurfaceSnapshots } from "@bgub/fig-reconciler/view-transitions";

export interface ViewTransitionPseudoElement {
  readonly selector: string;
  animate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ): Animation;
  getAnimations(): Animation[];
  getComputedStyle(): CSSStyleDeclaration;
}

export interface ViewTransitionPseudoElements {
  readonly group: ViewTransitionPseudoElement;
  readonly imagePair: ViewTransitionPseudoElement;
  readonly new: ViewTransitionPseudoElement | null;
  readonly old: ViewTransitionPseudoElement | null;
}

const domSurfaces = new WeakMap<
  ViewTransitionSurface,
  { owner: Document; snapshots: ViewTransitionSurfaceSnapshots }
>();

export function createDOMViewTransitionSurface(
  element: Element,
  name: string,
  snapshots: ViewTransitionSurfaceSnapshots,
): ViewTransitionSurface {
  const surface: ViewTransitionSurface = { name };
  domSurfaces.set(surface, { owner: element.ownerDocument, snapshots });
  return surface;
}

export function getViewTransitionPseudoElements(
  surface: ViewTransitionSurface,
): ViewTransitionPseudoElements {
  const resolved = domSurfaces.get(surface);
  if (resolved === undefined) {
    throw new Error(
      "The view-transition surface was not created by Fig DOM. Read pseudo " +
        "elements from a surface passed to <ViewTransition onTransition>.",
    );
  }

  const name = escapeViewTransitionName(surface.name);
  const pseudo = (kind: string): ViewTransitionPseudoElement =>
    createPseudoElement(
      resolved.owner.documentElement,
      `::view-transition-${kind}(${name})`,
    );
  return {
    group: pseudo("group"),
    imagePair: pseudo("image-pair"),
    new: resolved.snapshots.new ? pseudo("new") : null,
    old: resolved.snapshots.old ? pseudo("old") : null,
  };
}

function createPseudoElement(
  element: HTMLElement,
  selector: string,
): ViewTransitionPseudoElement {
  return {
    selector,
    animate(keyframes, options): Animation {
      const resolvedOptions: KeyframeAnimationOptions =
        typeof options === "number"
          ? { duration: options, pseudoElement: selector }
          : { ...options, pseudoElement: selector };
      return element.animate(keyframes, resolvedOptions);
    },
    getAnimations(): Animation[] {
      return element.getAnimations({ subtree: true }).filter((animation) => {
        const effect = animation.effect;
        return (
          effect !== null &&
          "target" in effect &&
          effect.target === element &&
          "pseudoElement" in effect &&
          effect.pseudoElement === selector
        );
      });
    },
    getComputedStyle(): CSSStyleDeclaration {
      return (
        element.ownerDocument.defaultView?.getComputedStyle(
          element,
          selector,
        ) ?? getComputedStyle(element, selector)
      );
    },
  };
}

export function escapeViewTransitionName(name: string): string {
  return globalThis.CSS?.escape?.(name) ?? name;
}
