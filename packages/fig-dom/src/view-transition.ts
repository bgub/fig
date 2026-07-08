import type { Props } from "@bgub/fig";
import type { ViewTransitionCommitResult } from "@bgub/fig-reconciler";
import type { Container } from "./events.ts";

interface RunningViewTransition {
  finished?: Promise<unknown>;
  ready?: Promise<unknown>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void,
  ) => RunningViewTransition | undefined;
};

interface CssGlobal {
  CSS?: {
    escape?: (value: string) => string;
  };
}

export function commitViewTransition(
  container: Container,
  prepareSnapshot: () => void,
  mutate: () => void,
  cleanup: () => void,
): ViewTransitionCommitResult {
  const owner = ownerDocument(container) as ViewTransitionDocument;
  const start = owner.startViewTransition;
  if (typeof start !== "function") return false;

  prepareSnapshot();
  let didMutate = false;

  try {
    const transition = start.call(owner, () => {
      didMutate = true;
      mutate();
    });
    const cleanupAfterSnapshot = transition?.ready ?? transition?.finished;
    if (cleanupAfterSnapshot === undefined) cleanup();
    else cleanupAfterSnapshot.then(cleanup, cleanup);
    return didMutate ? "committed" : "deferred";
  } catch (error) {
    cleanup();
    if (didMutate) throw error;
    return false;
  }
}

export function applyViewTransitionName(
  element: Element,
  name: string,
  className: string | null,
): void {
  const style = (element as HTMLElement).style as CSSStyleDeclaration & {
    viewTransitionClass?: string;
    viewTransitionName?: string;
  };

  style.viewTransitionName = escapeViewTransitionName(name);
  if (className !== null) style.viewTransitionClass = className;
}

export function restoreViewTransitionName(
  element: Element,
  props: Props,
): void {
  const style = (element as HTMLElement).style as CSSStyleDeclaration & {
    viewTransitionClass?: string;
    viewTransitionName?: string;
  };
  const styleProp = props.style as Record<string, unknown> | undefined;
  const name =
    styleProp?.viewTransitionName ?? styleProp?.["view-transition-name"];
  const className =
    styleProp?.viewTransitionClass ?? styleProp?.["view-transition-class"];

  style.viewTransitionName = styleValue(name);
  style.viewTransitionClass = styleValue(className);
}

function ownerDocument(container: Container): Document {
  return "ownerDocument" in container && container.ownerDocument !== null
    ? container.ownerDocument
    : document;
}

function escapeViewTransitionName(name: string): string {
  const escape = (globalThis as CssGlobal).CSS?.escape;
  return escape === undefined ? name : escape(name);
}

function styleValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  return "";
}
