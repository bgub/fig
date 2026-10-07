import type { PartReference } from "../internal/part-reference.ts";
import { createPartCollection } from "../internal/registration.ts";
import { createComposite } from "../internal/composite.ts";

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
  const labels = new WeakMap<HTMLElement, PartReference>();
  const registrations = createPartCollection<MenuItemRegistration>();

  function bindMenuItem(
    node: HTMLElement,
    signal: AbortSignal,
    config: MenuItemConfig,
  ): void {
    const registration = { ...config, node };
    registrations.bind(node, signal, registration);
    composite.bindItem(node, signal, config.value, config.disabled);
  }

  function menuItemAt(target: EventTarget | null) {
    const item = composite.itemAt(target);
    return item === undefined ? undefined : registrations.get(item.node);
  }

  function bindMenu(
    node: HTMLElement,
    signal: AbortSignal,
    label: PartReference,
  ): void {
    labels.set(node, label);
    composite.bindContainer(node, signal);
  }

  return {
    ...composite,
    bindMenu,
    bindMenuItem,
    menuItemAt,
    syncLabel: (node: HTMLElement, id: string | undefined) =>
      labels.get(node)?.sync(node, id),
  };
}
