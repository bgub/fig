import { type Composite, sameValue } from "./composite.ts";
import { assertPanelOwner, assertUniqueValues } from "./diagnostics.ts";
import { createPartCollection, setIdReference } from "./parts.ts";

/**
 * Pairs composite items with the panels they control.
 *
 * Generated ids cover the ordinary case at render time, but a caller may put
 * its own id on either host, so the committed DOM is the only place the real
 * pairing can be resolved.
 */
export function createRelations(
  composite: Composite,
  registrationChanged: () => void,
) {
  const panels = createPartCollection<unknown>(registrationChanged);

  function bindPanel(
    node: HTMLElement,
    signal: AbortSignal,
    value: unknown,
  ): void {
    panels.bind(node, signal, value);
    assertUniqueValues(panels.items(), "panel");
  }

  function sync(): void {
    const items = composite.items();
    const mountedPanels = panels.items();
    assertUniqueValues(mountedPanels, "panel");
    for (const item of items) {
      const panel = mountedPanels.find((entry) =>
        sameValue(entry.value, item.value),
      );
      setIdReference(item.node, "aria-controls", panel?.node.id);
    }
    for (const panel of mountedPanels) {
      const owner = items.find((item) => sameValue(item.value, panel.value));
      assertPanelOwner(owner?.node);
      setIdReference(panel.node, "aria-labelledby", owner?.node.id);
    }
  }

  return { bindPanel, sync };
}
