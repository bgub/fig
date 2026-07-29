import {
  assertAccessibleName,
  assertSinglePart,
} from "../internal/diagnostics.ts";
import { createPartCollection, setIdReference } from "../internal/parts.ts";

export type DialogRegistry = ReturnType<typeof createDialogRegistry>;

/**
 * Tracks the hosts of one dialog and drives the native element.
 *
 * `<dialog>` owns the hard parts — the top layer, focus containment, focus
 * restoration, inert background, and Escape — so the widget only decides when
 * it should be open and keeps its labelling in step with the committed DOM.
 */
export function createDialogRegistry(
  registrationChanged: () => void,
  generated: {
    readonly descriptionId: string;
    readonly titleId: string;
  },
) {
  const parts = createPartCollection<"description" | "dialog" | "title">(
    registrationChanged,
  );

  function bindDialog(node: HTMLElement, signal: AbortSignal): void {
    if (node instanceof HTMLDialogElement) parts.bind(node, signal, "dialog");
  }

  function node(): HTMLDialogElement | null {
    const current = part("dialog");
    return current instanceof HTMLDialogElement ? current : null;
  }

  /** Reconciles labelling and modality against the committed DOM. */
  function sync(open: boolean): void {
    const current = node();
    if (current === null) return;
    syncPartReference(
      current,
      "aria-labelledby",
      part("title")?.id,
      generated.titleId,
      !current.hasAttribute("aria-label"),
    );
    syncPartReference(
      current,
      "aria-describedby",
      part("description")?.id,
      generated.descriptionId,
      true,
    );
    assertAccessibleName(current, "dialog");
    if (open && !current.open) current.showModal();
    else if (!open && current.open) current.close();
  }

  return {
    bindDescription: (partNode: HTMLElement, signal: AbortSignal) =>
      parts.bind(partNode, signal, "description"),
    bindDialog,
    bindTitle: (partNode: HTMLElement, signal: AbortSignal) =>
      parts.bind(partNode, signal, "title"),
    node,
    sync,
  };

  function part(kind: "description" | "dialog" | "title") {
    const matches = parts.items().filter((entry) => entry.value === kind);
    assertSinglePart(matches, `dialog ${kind}`);
    return matches.at(-1)?.node;
  }
}

function syncPartReference(
  node: HTMLElement,
  name: string,
  mountedId: string | undefined,
  generatedId: string,
  useWhenMissing: boolean,
): void {
  const current = node.getAttribute(name);
  if (mountedId !== undefined) {
    if (current === generatedId || (current === null && useWhenMissing)) {
      setIdReference(node, name, mountedId);
    }
  } else if (current === generatedId) {
    setIdReference(node, name, undefined);
  }
}
