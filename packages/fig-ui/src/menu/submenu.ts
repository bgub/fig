import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { bindPart } from "../internal/parts.ts";
import { type MenuOptions, type MenuParts, useMenu } from "./menu.tsx";
import {
  type MenuFocusTarget,
  type MenuController,
  menuClosesOnSelect,
  menuController,
  registerMenuController,
} from "./controller.ts";

export interface MenuSubmenuOptions<
  Value = unknown,
> extends MenuOptions<Value> {
  /** Delay for mouse opening and closing. Defaults to 100ms. */
  delay?: number;
  /** Disables the trigger in its parent menu. */
  disabled?: boolean;
}

export interface MenuSubmenuProps<
  ParentValue,
  Value = unknown,
> extends MenuSubmenuOptions<Value> {
  children: (submenu: MenuParts<Value>) => FigNode;
  parent: MenuParts<ParentValue>;
  value: ParentValue;
}

interface SubmenuState {
  readonly closeTree: () => void;
  readonly disabled: boolean;
  readonly hover: (open: boolean | undefined, focus: MenuFocusTarget) => void;
  readonly open: boolean;
  readonly setOpen: (open: boolean, focus?: MenuFocusTarget) => void;
}

const submenuTriggerBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SubmenuState) => ({
    bind: bindPart(context, () => {
      if (state.disabled) state.hover(undefined, false);
    }),
    "aria-disabled": state.disabled ? "true" : undefined,
    "data-disabled": state.disabled ? "" : undefined,
    mix: [
      on("keydown", (event) => {
        state.hover(undefined, false);
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.keyCode === 229 ||
          state.disabled
        )
          return;
        if (event.key !== submenuOpenKey(event.currentTarget)) return;
        event.preventDefault();
        state.setOpen(true, "first");
      }),
      on("pointerenter", (event) => {
        if (state.disabled || event.pointerType !== "mouse") return;
        state.hover(state.open ? undefined : true, false);
      }),
      on("pointerleave", (event) => {
        if (event.pointerType === "mouse") state.hover(false, false);
      }),
    ],
  }),
);

const submenuMenuBehavior = /* @__PURE__ */ createMixin(
  (_context: MixinContext, state: SubmenuState) => ({
    mix: [
      on("keydown", (event) => {
        state.hover(undefined, false);
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        if (event.key === "Tab") {
          state.closeTree();
          return;
        }
        if (event.key !== submenuCloseKey(event.currentTarget)) return;
        event.preventDefault();
        state.setOpen(false);
      }),
      on("pointerenter", (event) => {
        if (event.pointerType === "mouse") state.hover(undefined, false);
      }),
      on("pointerleave", (event) => {
        if (event.pointerType === "mouse") state.hover(false, false);
      }),
    ],
  }),
);

const submenuTriggerMixin = /* @__PURE__ */ createMixin(
  (
    context: MixinContext,
    parent: MenuController,
    child: MenuController,
    value: unknown,
    state: SubmenuState,
  ) => {
    const disabled = state.disabled || context.props.disabled === true;
    return [
      parent.submenuTrigger(value, disabled),
      child.trigger(false, disabled),
      submenuTriggerBehavior({ ...state, disabled }),
    ];
  },
);

const submenuMenuMixin = /* @__PURE__ */ createMixin(
  (_context: MixinContext, menu: MixinDescriptor, state: SubmenuState) => [
    menu,
    submenuMenuBehavior(state),
  ],
);

/** A nested menu whose trigger remains an item in its parent menu. */
export function useMenuSubmenu<ParentValue, Value = unknown>(
  parent: MenuParts<ParentValue>,
  value: ParentValue,
  options: MenuSubmenuOptions<Value> = {},
): MenuParts<Value> {
  const { delay = 100, disabled = false, ...menuOptions } = options;
  const parentController = menuController(parent);
  const menu = useMenu<Value>({
    ...menuOptions,
    onSelect: (selected, details, signal) => {
      menuOptions.onSelect?.(selected, details, signal);
      if (!details.isCanceled && menuClosesOnSelect(details)) {
        parentController.closeTree(focusedItem());
      }
    },
  });
  const controller = menuController(menu);
  const timer = useMemo<{ value: ReturnType<typeof setTimeout> | undefined }>(
    () => ({ value: undefined }),
    [],
  );
  const hover = useStableEvent(
    (
      next: boolean | undefined,
      focus: MenuFocusTarget,
      signal: AbortSignal,
    ) => {
      if (timer.value !== undefined) clearTimeout(timer.value);
      timer.value = undefined;
      if (next === undefined) return;
      timer.value = setTimeout(() => {
        timer.value = undefined;
        if (!signal.aborted) controller.setOpen(next, focus);
      }, delay);
      signal.addEventListener(
        "abort",
        () => {
          if (timer.value !== undefined) clearTimeout(timer.value);
          timer.value = undefined;
        },
        { once: true },
      );
    },
  );
  useBeforePaint(() => {
    if (!parent.open || disabled) hover(undefined, false);
  });
  function focusedItem(): Element | undefined {
    const popup = controller.popup();
    const active = popup?.ownerDocument.activeElement;
    return active !== null && active !== undefined && popup?.contains(active)
      ? active
      : undefined;
  }
  const closeTree = useStableEvent((focusOrigin?: Element) => {
    const origin = focusOrigin ?? focusedItem();
    menu.setOpen(false);
    parentController.closeTree(origin);
  });
  const state = {
    closeTree,
    disabled,
    hover,
    open: menu.open,
    setOpen: (open: boolean, focus?: MenuFocusTarget) =>
      controller.setOpen(open, focus),
  };

  const parts: MenuParts<Value> = {
    ...menu,
    menu: () => submenuMenuMixin(menu.menu(), state),
    trigger: () =>
      submenuTriggerMixin(parentController, controller, value, state),
  };
  registerMenuController(parts, { ...controller, closeTree });
  return parts;
}

/** {@link useMenuSubmenu} as a render-callback component. */
export function MenuSubmenu<ParentValue, Value = unknown>(
  props: MenuSubmenuProps<ParentValue, Value>,
): FigNode {
  return props.children(useMenuSubmenu(props.parent, props.value, props));
}

function submenuOpenKey(target: EventTarget | null): string {
  return rightToLeft(target) ? "ArrowLeft" : "ArrowRight";
}

function submenuCloseKey(target: EventTarget | null): string {
  return rightToLeft(target) ? "ArrowRight" : "ArrowLeft";
}

function rightToLeft(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const direction = getComputedStyle(target).direction;
  return direction
    ? direction === "rtl"
    : target.closest("[dir]")?.getAttribute("dir") === "rtl";
}
