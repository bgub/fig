import {
  assertAccessibleName,
  assertSinglePart,
} from "../internal/diagnostics.ts";
import type { PartReference } from "../internal/part-reference.ts";
import { createPartCollection } from "../internal/registration.ts";

export type DialogRegistry = ReturnType<typeof createDialogRegistry>;

/**
 * Tracks the hosts of one dialog and drives the native element.
 *
 * `<dialog>` owns the hard parts — the top layer, focus containment, focus
 * restoration, inert background, and Escape — so the widget only decides when
 * it should be open and keeps its labelling in step with the committed DOM.
 */
export function createDialogRegistry(registrationChanged: () => void) {
  const parts = createPartCollection<"description" | "dialog" | "title">(
    registrationChanged,
  );

  let backdropPress: boolean | undefined;

  const references = new WeakMap<
    HTMLElement,
    { readonly title: PartReference; readonly description: PartReference }
  >();

  function bindDialog(
    node: HTMLElement,
    signal: AbortSignal,
    automatic: {
      readonly title: PartReference;
      readonly description: PartReference;
    },
  ): void {
    if (!(node instanceof HTMLDialogElement)) return;
    references.set(node, automatic);
    parts.bind(node, signal, "dialog");
  }

  function node(): HTMLDialogElement | null {
    const current = part("dialog");
    return current instanceof HTMLDialogElement ? current : null;
  }

  /** Reconciles labelling and modality against the committed DOM. */
  function sync(open: boolean): void {
    const current = node();
    if (current === null) return;
    if (!open) backdropPress = undefined;
    const automatic = references.get(current);
    automatic?.title.sync(current, part("title")?.id);
    automatic?.description.sync(current, part("description")?.id);
    // Closed shells may defer their title and content until opened.
    if (open) assertAccessibleName(current, "dialog");
    if (open && !current.open) current.showModal();
    else if (!open && current.open) current.close();
  }

  return {
    bindDescription: (partNode: HTMLElement, signal: AbortSignal) =>
      parts.bind(partNode, signal, "description"),
    bindDialog,
    noteBackdropPress: (outside: boolean | undefined) => {
      backdropPress = outside;
    },
    takeBackdropPress: () => {
      const outside = backdropPress;
      backdropPress = undefined;
      return outside;
    },
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
