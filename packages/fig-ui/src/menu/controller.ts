import type { MixinDescriptor } from "@bgub/fig";

export type MenuFocusTarget = "first" | "last" | false;

export interface MenuController {
  closeTree(): void;
  setOpen(open: boolean, focus?: MenuFocusTarget): void;
  submenuTrigger(value: unknown, disabled: boolean): MixinDescriptor;
  trigger(openWithArrows: boolean): MixinDescriptor;
}

const controllers = new WeakMap<object, MenuController>();
const closingSelections = new WeakSet<object>();

export function registerMenuController(
  parts: object,
  controller: MenuController,
): void {
  controllers.set(parts, controller);
}

export function menuController(parts: object): MenuController {
  const controller = controllers.get(parts);
  if (controller === undefined) {
    throw new Error("Fig UI submenu parent must come from useMenu().");
  }
  return controller;
}

export function markMenuClose(details: object, close: boolean): void {
  if (close) closingSelections.add(details);
}

export function menuClosesOnSelect(details: object): boolean {
  return closingSelections.has(details);
}
