import { createPartReference } from "../internal/part-reference.ts";
import {
  createMixin,
  type MixinContext,
  type MixinDescriptor,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { bindPart, triggerProps } from "../internal/parts.ts";
import type {
  MenuItemConfig,
  MenuItemRegistration,
  MenuRegistry,
} from "./registry.ts";

interface MenuTriggerOwnState {
  readonly disabled?: boolean;
  readonly openWithArrows: boolean;
}

/** Widget-level state every part reads. Built once per root render. */
export interface MenuPartState {
  readonly noteNativeToggle: (event: Event) => void;
  readonly activate: (item: MenuItemRegistration, event: Event) => void;
  readonly close: () => void;
  readonly noteTrigger: (node: HTMLElement, signal: AbortSignal) => void;
  readonly open: (at: "first" | "last") => void;
  readonly registry: MenuRegistry;
  readonly triggerId: string;
}

const menuTriggerBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: MenuPartState, own: MenuTriggerOwnState) => ({
    "aria-haspopup": "menu",
    bind: bindPart(context, state.registry, state.noteTrigger),
    id: context.props.id ?? state.triggerId,
    // Click already opens through popovertarget; these are the keys the
    // pattern adds, and each one says where focus should land.
    mix: on("keydown", (event) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;
      if (own.disabled) {
        if (event.key === "Enter" || event.key === " ") event.preventDefault();
        return;
      }
      if (
        event.key === "Enter" ||
        (own.openWithArrows && event.key === "ArrowDown")
      ) {
        event.preventDefault();
        state.open("first");
      } else if (own.openWithArrows && event.key === "ArrowUp") {
        event.preventDefault();
        state.open("last");
      }
    }),
  }),
);

const menuBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: MenuPartState) => {
    const label = createPartReference(
      context,
      "aria-labelledby",
      state.triggerId,
    );
    return {
      ...label.props,
      bind: bindPart(context, state.registry, (node, signal) =>
        state.registry.bindMenu(node, signal, label),
      ),
      mix: on("keydown", (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        // Escape and light dismiss belong to the platform; everything that
        // moves or commits inside the menu belongs here.
        if (event.key === "Tab") {
          state.close();
          return;
        }
        const item = state.registry.menuItemAt(event.target);
        if (
          item !== undefined &&
          (event.key === "Enter" || event.key === " ")
        ) {
          if (item.kind === "submenu") return;
          event.preventDefault();
          if (!item.disabled && !(item.kind === "radio" && item.checked)) {
            state.activate(item, event);
          }
          return;
        }
        if (item === undefined) {
          // Empty/loading menus focus the container. Once items arrive, a
          // navigation key enters the list without requiring a reopen.
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          if (event.key === "ArrowDown" || event.key === "Home") {
            event.preventDefault();
            state.open("first");
          } else if (event.key === "ArrowUp" || event.key === "End") {
            event.preventDefault();
            state.open("last");
          } else state.registry.focusByTypeahead(event.key);
          return;
        }
        const moved = state.registry.moveFocus(event, {
          loop: true,
          orientation: "vertical",
        });
        if (
          moved === undefined &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          state.registry.focusByTypeahead(event.key);
        }
      }),
      role: "menu",
      tabindex: context.props.tabindex ?? -1,
    };
  },
);

/**
 * Layers menu semantics over the popover parts the menu is built on. Both are
 * descriptors, so they compose the way any two authored mixins would.
 */
export const menuTriggerMixin = /* @__PURE__ */ createMixin(
  (
    _context: MixinContext,
    state: MenuPartState,
    popoverTrigger: MixinDescriptor,
    own: MenuTriggerOwnState,
  ) => [popoverTrigger, menuTriggerBehavior(state, own)],
);

export const menuMixin = /* @__PURE__ */ createMixin(
  (
    _context: MixinContext,
    state: MenuPartState,
    popoverMenu: MixinDescriptor,
  ) => [
    on("beforetoggle", state.noteNativeToggle, { capture: true }),
    popoverMenu,
    menuBehavior(state),
  ],
);

export const menuItemMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: MenuPartState, own: MenuItemConfig) => {
    const disabled = own.disabled || context.props.disabled === true;
    return {
      ...triggerProps(context, { disabled }),
      "aria-checked":
        own.kind === "checkbox" || own.kind === "radio"
          ? own.checked
            ? "true"
            : "false"
          : undefined,
      bind: bindPart(context, state.registry, (node, signal) =>
        state.registry.bindMenuItem(node, signal, { ...own, disabled }),
      ),
      "data-checked": own.checked ? "" : undefined,
      mix: on("click", (event) => {
        if (event.defaultPrevented) return;
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (event.button !== 0 || own.kind === "submenu") return;
        const item = state.registry.menuItemAt(event.currentTarget);
        if (item !== undefined && !(item.kind === "radio" && item.checked)) {
          state.activate(item, event);
        }
      }),
      role:
        own.kind === "checkbox"
          ? "menuitemcheckbox"
          : own.kind === "radio"
            ? "menuitemradio"
            : "menuitem",
      // Focus moves between items directly, so none of them is a tab stop:
      // Tab leaves the menu rather than walking it.
      tabindex: -1,
    };
  },
);
