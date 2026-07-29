import { createComposite, onAbort } from "../internal/composite.ts";

export type MenuItemKind = "checkbox" | "item" | "radio" | "submenu";

export interface MenuItemConfig {
  readonly checked: boolean | undefined;
  readonly closeOnSelect: boolean;
  readonly disabled: boolean;
  readonly kind: MenuItemKind;
  readonly value: unknown;
}

export interface MenuItemRegistration extends MenuItemConfig {
  readonly node: HTMLElement;
}

export type MenuRegistry = ReturnType<typeof createMenuRegistry>;

/** Adds menu activation metadata to the shared focus composite. */
export function createMenuRegistry() {
  const composite = createComposite({
    container: '[role="menu"]',
    item: '[role^="menuitem"]',
    name: "menu",
  });
  const registrations = new Map<HTMLElement, MenuItemRegistration>();

  function bindMenuItem(
    node: HTMLElement,
    signal: AbortSignal,
    config: MenuItemConfig,
  ): void {
    const registration = { ...config, node };
    registrations.set(node, registration);
    composite.bindItem(node, signal, config.value, config.disabled);
    onAbort(signal, () => {
      if (registrations.get(node) === registration) registrations.delete(node);
    });
  }

  function menuItemAt(target: EventTarget | null) {
    const item = composite.itemAt(target);
    return item === undefined ? undefined : registrations.get(item.node);
  }

  return { ...composite, bindMenuItem, menuItemAt };
}
