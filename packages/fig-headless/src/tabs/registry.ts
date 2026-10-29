import {
  type CompositeItem,
  createComposite,
  type Orientation,
  sameValue,
} from "../internal/composite.ts";
import { createRelations } from "../internal/relations.ts";
import { assertAccessibleName } from "../internal/diagnostics.ts";

export type TabsOrientation = Orientation;

export type TabsRegistry = ReturnType<typeof createTabsRegistry>;

/**
 * The shared composite plus what only tabs need: panel relationships.
 */
export function createTabsRegistry(registrationChanged: () => void) {
  const composite = createComposite({
    container: '[role="tablist"]',
    item: '[role="tab"]',
    name: "tabs",
    registrationChanged,
  });

  const relations = createRelations(composite, registrationChanged);

  /** Synchronizes panel relationships against the committed DOM. */
  function sync(): void {
    relations.sync();
    const container = composite.containerNode();
    if (container !== null) assertAccessibleName(container, "tab list");
  }

  return {
    ...composite,
    bindPanel: relations.bindPanel,
    sync,
  };
}

export type { CompositeItem as TabsTabRegistration };
export { sameValue };
