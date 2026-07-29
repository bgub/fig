import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { activateOnClick, bindPart, triggerProps } from "../internal/parts.ts";
import type { TabsOrientation, TabsRegistry } from "./registry.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface TabsPartState {
  readonly orientation: TabsOrientation;
  readonly registry: TabsRegistry;
  readonly resetHighlight: () => void;
  readonly select: (value: unknown, event: Event, trigger: Element) => void;
  readonly setHighlighted: (value: unknown) => void;
}

interface TabsListOwnState {
  readonly activateOnFocus: boolean;
  readonly loopFocus: boolean;
}

interface TabsTabOwnState {
  readonly disabled: boolean;
  readonly highlighted: boolean;
  readonly panelId: string;
  readonly selected: boolean;
  readonly tabId: string;
  readonly value: unknown;
}

interface TabsPanelOwnState {
  readonly active: boolean;
  readonly panelId: string;
  readonly tabId: string;
  readonly value: unknown;
}

// The list owns every tab interaction: tabs are plain hosts carrying
// attributes, so listeners stay O(1) in the number of tabs and each tab's own
// handlers still run first, in the target phase.
export const listMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TabsPartState, own: TabsListOwnState) => ({
    ...partProps(state),
    "aria-orientation": state.orientation,
    bind: bindPart(context, (node, signal) =>
      state.registry.bindContainer(node, signal),
    ),
    mix: [
      on(
        "click",
        activateOnClick(state.registry, (tab, event) =>
          state.select(tab.value, event, tab.node),
        ),
      ),
      on("keydown", (event) => {
        const tab = state.registry.itemAt(event.target);
        if (tab === undefined) return;
        // Automatic activation already selected on focus, and native buttons
        // turn Enter and Space into clicks.
        if (
          !own.activateOnFocus &&
          !tab.disabled &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          state.select(tab.value, event, tab.node);
          return;
        }
        state.registry.moveFocus(event, {
          loop: own.loopFocus,
          orientation: state.orientation,
        });
      }),
      on("focusin", (event) => {
        const tab = state.registry.itemAt(event.target);
        if (tab === undefined) return;
        state.setHighlighted(tab.value);
        if (
          own.activateOnFocus &&
          !tab.disabled &&
          !state.registry.pointerActive()
        ) {
          state.select(tab.value, event, tab.node);
        }
      }),
      on("focusout", (event) => {
        const list = event.currentTarget;
        const next = event.relatedTarget;
        if (
          list instanceof Element &&
          (!(next instanceof Node) || !list.contains(next))
        ) {
          state.resetHighlight();
        }
      }),
      // Click owns primary-pointer activation, so focus must not race it.
      on("pointerdown", (event, signal) => {
        state.registry.notePointerDown(event.currentTarget, signal);
      }),
    ],
    role: "tablist",
  }),
);

export const tabMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TabsPartState, own: TabsTabOwnState) => {
    const disabled = own.disabled || context.props.disabled === true;
    return {
      ...partProps(state),
      ...triggerProps(context, { disabled, id: own.tabId }),
      "aria-controls": own.panelId,
      "aria-selected": own.selected ? "true" : "false",
      "data-active": own.selected ? "" : undefined,
      bind: bindPart(context, (node, signal) =>
        state.registry.bindItem(node, signal, own.value, disabled),
      ),
      role: "tab",
      tabindex: own.highlighted ? 0 : -1,
    };
  },
);

export const panelMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TabsPartState, own: TabsPanelOwnState) => ({
    ...partProps(state),
    "aria-labelledby": own.tabId,
    "data-hidden": own.active ? undefined : "",
    bind: bindPart(context, (node, signal) =>
      state.registry.bindPanel(node, signal, own.value),
    ),
    hidden: own.active ? undefined : true,
    id: context.props.id ?? own.panelId,
    inert: own.active ? undefined : true,
    role: "tabpanel",
    tabindex: own.active ? (context.props.tabindex ?? 0) : -1,
  }),
);

function partProps(state: TabsPartState) {
  return {
    "data-orientation": state.orientation,
  };
}
