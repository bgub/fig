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
import { createHoverIntent } from "../internal/hover.ts";
import { trackHoverTransit } from "../internal/hover-transit.ts";
import { createPartSlot } from "../internal/registration.ts";
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
  readonly activate: (event?: MouseEvent) => void;
  readonly notePointer: (type: string) => void;
  readonly closeTree: () => void;
  readonly disabled: boolean;
  readonly hover: (open?: boolean, event?: PointerEvent) => void;
  readonly bindTrigger: (node: HTMLElement, signal: AbortSignal) => boolean;
  readonly open: boolean;
  readonly popup: () => HTMLElement | null;
  readonly setOpen: (open: boolean, focus?: MenuFocusTarget) => void;
}

const submenuTriggerBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SubmenuState) => ({
    bind: bindPart(context, state.bindTrigger, (node, signal) => {
      if (state.bindTrigger(node, signal))
        signal.addEventListener("abort", () => state.hover(), { once: true });
      if (state.disabled) state.hover();
    }),
    "aria-disabled": state.disabled ? "true" : undefined,
    "data-disabled": state.disabled ? "" : undefined,
    mix: [
      on("focusout", (event) => {
        if (
          event.relatedTarget instanceof Node &&
          state.popup()?.contains(event.relatedTarget)
        )
          return;
        state.hover();
        state.setOpen(false, false);
      }),
      on("keydown", (event) => {
        state.hover();
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
        state.hover(state.open ? undefined : true, event);
      }),
      on("pointerleave", (event) => {
        if (event.pointerType === "mouse") state.hover(false, event);
      }),
    ],
  }),
);

const submenuMenuBehavior = /* @__PURE__ */ createMixin(
  (_context: MixinContext, state: SubmenuState) => ({
    mix: [
      on("keydown", (event) => {
        state.hover();
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
        if (event.pointerType === "mouse") state.hover();
      }),
      on("pointerleave", (event) => {
        if (event.pointerType === "mouse") state.hover(false, event);
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
      on("pointerdown", (event) => state.notePointer(event.pointerType)),
      on("click", (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        event.preventDefault();
        if (disabled) return;
        // Mouse presses enter a revealed submenu. Touch and virtual clicks
        // toggle it so assistive users can return to the parent menu.
        state.activate(event);
      }),
      on("keydown", (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.keyCode === 229 ||
          event.key !== "Enter"
        )
          return;
        event.preventDefault();
        if (!disabled) state.activate();
      }),
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
  const intent = useMemo(createHoverIntent, []);
  const trigger = useMemo(() => createPartSlot(() => {}), []);
  const activation = useMemo(
    () => ({ openedOnHover: false, pointerType: "" }),
    [],
  );
  const hover = useStableEvent(
    (
      next: boolean | undefined,
      event: PointerEvent | undefined,
      signal: AbortSignal,
    ) => {
      intent.cancel();
      if (next === undefined) return;
      const anchor = trigger.node();
      const commit = () => {
        if (trigger.node() !== anchor || !anchor?.isConnected) return;
        activation.openedOnHover = next;
        controller.setOpen(next, false);
      };
      const popup = controller.popup();
      if (
        !next &&
        menu.open &&
        event !== undefined &&
        popup !== null &&
        anchor !== null
      ) {
        trackHoverTransit(
          event,
          event.currentTarget === anchor ? popup : anchor,
          commit,
          delay,
          signal,
        );
      } else intent.schedule(next, commit, delay, signal);
    },
  );
  useBeforePaint(() => {
    if (!parent.open || disabled) hover(undefined, undefined);
  });
  useBeforePaint(() => {
    if (!menu.open) {
      activation.openedOnHover = false;
      hover(undefined, undefined);
    }
  }, [menu.open]);
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
    notePointer: (type: string) => {
      activation.pointerType = type;
    },
    activate: (event?: MouseEvent) => {
      hover(undefined, undefined);
      // WebKit reports mouse clicks after touch pointer events. Use the
      // pointerdown source; zero-detail virtual clicks still toggle.
      const mouse =
        event !== undefined &&
        event.detail > 0 &&
        activation.pointerType === "mouse";
      activation.pointerType = "";
      const next = !menu.open || activation.openedOnHover || mouse;
      activation.openedOnHover = false;
      controller.setOpen(next, "first");
    },
    closeTree,
    disabled,
    hover: (next?: boolean, event?: PointerEvent) => hover(next, event),
    bindTrigger: trigger.bind,
    open: menu.open,
    popup: () => controller.popup(),
    setOpen: (open: boolean, focus?: MenuFocusTarget) => {
      activation.openedOnHover = false;
      controller.setOpen(open, focus);
    },
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
