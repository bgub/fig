import type { ViewTransitionSurface } from "@bgub/fig";
import type { ViewTransitionSurfaceSnapshots } from "@bgub/fig-reconciler/view-transitions";

/** Describes view transition pseudo element. */
export interface ViewTransitionPseudoElement {
  readonly selector: string;
  animate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ): Animation;
  getAnimations(): Animation[];
  getComputedStyle(): CSSStyleDeclaration;
}

/** Describes view transition pseudo elements. */
export interface ViewTransitionPseudoElements {
  readonly group: ViewTransitionPseudoElement;
  readonly imagePair: ViewTransitionPseudoElement;
  readonly new: ViewTransitionPseudoElement | null;
  readonly old: ViewTransitionPseudoElement | null;
}

const domSurfaces = new WeakMap<
  ViewTransitionSurface,
  {
    owner: Document;
    snapshots: ViewTransitionSurfaceSnapshots;
    signal: AbortSignal;
  }
>();

export function createDOMViewTransitionSurface(
  element: Element,
  name: string,
  snapshots: ViewTransitionSurfaceSnapshots,
  signal: AbortSignal,
): ViewTransitionSurface {
  const surface: ViewTransitionSurface = { name };
  domSurfaces.set(surface, { owner: element.ownerDocument, snapshots, signal });
  return surface;
}

/** Gets view transition pseudo elements. */
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

  assertActiveSurface(resolved.signal);
  const name = escapeViewTransitionName(surface.name);
  const pseudo = (kind: string): ViewTransitionPseudoElement =>
    createPseudoElement(
      resolved.owner.documentElement,
      `::view-transition-${kind}(${name})`,
      resolved.signal,
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
  signal: AbortSignal,
): ViewTransitionPseudoElement {
  return {
    selector,
    animate(keyframes, options): Animation {
      assertActiveSurface(signal);
      const resolvedOptions: KeyframeAnimationOptions =
        typeof options === "number"
          ? { duration: options, pseudoElement: selector }
          : { ...options, pseudoElement: selector };
      const animation = element.animate(keyframes, resolvedOptions);
      signal.addEventListener(
        "abort",
        () => {
          try {
            animation.cancel();
          } catch {
            // Cancellation is best-effort; other surface animations must still release.
          }
        },
        { once: true },
      );
      return animation;
    },
    getAnimations(): Animation[] {
      assertActiveSurface(signal);
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
      assertActiveSurface(signal);
      return (
        element.ownerDocument.defaultView?.getComputedStyle(
          element,
          selector,
        ) ?? getComputedStyle(element, selector)
      );
    },
  };
}

function assertActiveSurface(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("The view-transition surface is no longer active.");
  }
}

export function escapeViewTransitionName(name: string): string {
  return globalThis.CSS?.escape?.(name) ?? name;
}
