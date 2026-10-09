import {
  type FigNode,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import type { ChangeDetails } from "../internal/changes.ts";
import { createChangeDetails } from "../internal/changes.ts";
import { createPopupFocus } from "../internal/popup-focus.ts";
import { isNativeEnabled } from "../internal/composite.ts";
import { assertAccessibleName } from "../internal/diagnostics.ts";
import { createPartSlot } from "../internal/registration.ts";
import type {
  OpenChangeDetails,
  OpenChangeHandler,
} from "../internal/open-state.ts";
import { type PopoverOptions, usePopover } from "../popover/popover.tsx";
import { bindPopoverSource } from "../popover/registry.ts";
import { menuItemMixin, menuMixin, menuTriggerMixin } from "./parts.ts";
import {
  markMenuClose,
  registerMenuController,
  type MenuFocusTarget,
} from "./controller.ts";
import { createMenuRegistry, type MenuItemRegistration } from "./registry.ts";

export type MenuOpenChangeDetails = OpenChangeDetails;

export type MenuOpenChangeHandler = OpenChangeHandler;

export interface MenuSelectDetails extends ChangeDetails {
  readonly kind: "checkbox" | "item" | "radio";
}

export type MenuSelectHandler<Value = unknown> = (
  value: Value,
  details: MenuSelectDetails,
  signal: AbortSignal,
) => void;

export interface MenuItemOptions {
  /** Defaults to `true` for actions and `false` for checked items. */
  closeOnSelect?: boolean;
  disabled?: boolean;
}

export interface MenuCheckedItemOptions extends MenuItemOptions {
  checked: boolean;
}

export interface MenuOptions<Value = unknown> extends PopoverOptions {
  /** Runs when an item is chosen, before the menu closes. */
  onSelect?: MenuSelectHandler<Value>;
}

export interface MenuParts<Value = unknown> {
  readonly open: boolean;
  checkboxItem(value: Value, options: MenuCheckedItemOptions): MixinDescriptor;
  /** Applies to the caller's own popover element. */
  menu(): MixinDescriptor;
  item(value: Value, options?: MenuItemOptions): MixinDescriptor;
  radioItem(value: Value, options: MenuCheckedItemOptions): MixinDescriptor;
  setOpen(open: boolean): void;
  trigger(): MixinDescriptor;
}

export interface MenuProps<Value = unknown> extends MenuOptions<Value> {
  children: (menu: MenuParts<Value>) => FigNode;
}

/**
 * Coordinates one menu button.
 *
 * The popover underneath supplies the top layer, light dismiss, and Escape,
 * and the composite supplies ordering and movement. What the menu itself owns
 * is focus: `showPopover()` deliberately leaves focus where it was, so the
 * menu moves it to an item on open and returns it to the trigger on close.
 */
export function useMenu<Value = unknown>(
  options: MenuOptions<Value> = {},
): MenuParts<Value> {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const popover = usePopover(options);
  const registry = useMemo(() => createMenuRegistry(), []);
  const trigger = useMemo(() => createPartSlot(() => {}), []);
  const tracker = useMemo<{ pending: MenuFocusTarget | null }>(
    () => ({ pending: null }),
    [],
  );
  const focus = useMemo(
    () => createPopupFocus(registry.containerNode, trigger.node),
    [],
  );

  const noteTrigger = useStableEvent(
    (node: HTMLElement, signal: AbortSignal) => {
      bindPopoverSource(popover, node, signal);
      trigger.bind(node, signal);
    },
  );

  const emitSelect = useStableEvent(
    (value: unknown, details: MenuSelectDetails, signal: AbortSignal) => {
      options.onSelect?.(value as Value, details, signal);
    },
  );

  const open = useStableEvent((at: "first" | "last") => {
    setOpen(true, at);
  });

  const close = useStableEvent((focusOrigin?: Element) => {
    focus.closingFrom(focusOrigin);
    popover.setOpen(false);
  });

  const activate = useStableEvent(
    (item: MenuItemRegistration, event: Event) => {
      if (item.kind === "submenu") return;
      const details: MenuSelectDetails = {
        ...createChangeDetails(event, item.node),
        kind: item.kind,
      };
      markMenuClose(details, item.closeOnSelect);
      emitSelect(item.value, details);
      if (details.isCanceled) return;
      if (item.closeOnSelect) popover.setOpen(false);
    },
  );

  const setOpen = useStableEvent(
    (next: boolean, focus: MenuFocusTarget = "first") => {
      if (next) {
        if (popover.open) {
          tracker.pending = null;
          focusItem(focus);
        } else tracker.pending = focus;
      }
      popover.setOpen(next);
    },
  );

  // Focus is the menu's own work. It runs after the popover's own pass, which
  // is what puts the element in the top layer, so the items are reachable.
  useBeforePaint(() => {
    const menu = registry.containerNode();
    const triggerNode = trigger.node();
    if (menu !== null) {
      registry.syncLabel(menu, triggerNode?.id);
      assertAccessibleName(menu, "menu");
    }
    focus.sync(popover.open, () => {
      const pending = tracker.pending;
      tracker.pending = null;
      focusItem(pending);
    });
  });

  function focusItem(focus: MenuFocusTarget | null): void {
    if (focus === false) return;
    const items = registry.items().filter(isNativeEnabled);
    const target = focus === "last" ? items[items.length - 1] : items[0];
    (target?.node ?? registry.containerNode())?.focus();
  }

  const state = {
    noteNativeToggle: focus.beforeToggle,
    activate,
    close,
    noteTrigger,
    open,
    registry,
    triggerId,
  };

  const parts: MenuParts<Value> = {
    checkboxItem: (value, itemOptions) =>
      menuItemMixin(state, {
        checked: itemOptions.checked,
        closeOnSelect: itemOptions.closeOnSelect === true,
        disabled: itemOptions.disabled === true,
        kind: "checkbox",
        value,
      }),
    item: (value, itemOptions = {}) =>
      menuItemMixin(state, {
        checked: undefined,
        closeOnSelect: itemOptions.closeOnSelect !== false,
        disabled: itemOptions.disabled === true,
        kind: "item",
        value,
      }),
    menu: () => menuMixin(state, popover.popover()),
    open: popover.open,
    radioItem: (value, itemOptions) =>
      menuItemMixin(state, {
        checked: itemOptions.checked,
        closeOnSelect: itemOptions.closeOnSelect === true,
        disabled: itemOptions.disabled === true,
        kind: "radio",
        value,
      }),
    setOpen: (next) => setOpen(next),
    trigger: () =>
      menuTriggerMixin(state, popover.trigger(), {
        openWithArrows: true,
      }),
  };
  registerMenuController(parts, {
    closeTree: close,
    bindTrigger: noteTrigger,
    popup: registry.containerNode,
    setOpen,
    submenuTrigger: (value, itemDisabled) =>
      menuItemMixin(state, {
        checked: undefined,
        closeOnSelect: false,
        disabled: itemDisabled,
        kind: "submenu",
        value,
      }),
    trigger: (openWithArrows, disabled = false) =>
      menuTriggerMixin(state, popover.trigger(), { openWithArrows, disabled }),
  });
  return parts;
}

/**
 * {@link useMenu} as a component, for a menu that is not already a component
 * of its own. Opening re-renders this root rather than the caller.
 */
export function Menu<Value = unknown>(props: MenuProps<Value>): FigNode {
  return props.children(useMenu(props));
}
