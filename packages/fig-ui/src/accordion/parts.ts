import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { activateOnClick, bindPart, triggerProps } from "../internal/parts.ts";
import type { Composite, Orientation } from "../internal/composite.ts";
import { expectHost } from "../internal/diagnostics.ts";
import type { createRelations } from "../internal/relations.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface AccordionPartState {
  readonly disabled: boolean;
  readonly orientation: Orientation;
  readonly registry: Composite;
  readonly relations: ReturnType<typeof createRelations>;
  readonly toggle: (value: unknown, event: Event, trigger: Element) => void;
}

interface AccordionTriggerOwnState {
  readonly disabled: boolean;
  readonly open: boolean;
  readonly panelId: string;
  readonly triggerId: string;
  readonly value: unknown;
}

interface AccordionPanelOwnState {
  readonly open: boolean;
  readonly panelId: string;
  readonly triggerId: string;
  readonly value: unknown;
}

// The accordion owns trigger interaction the way the tab list does. Headers
// keep their place in the tab order, so arrow movement is an extra rather than
// a roving tab stop.
export const accordionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: AccordionPartState) => ({
    bind: bindPart(context, (node, signal) =>
      state.registry.bindContainer(node, signal),
    ),
    "data-disabled": state.disabled ? "" : undefined,
    "data-fig-accordion": "",
    "data-orientation": state.orientation,
    mix: [
      on(
        "click",
        activateOnClick(state.registry, (trigger, event) =>
          state.toggle(trigger.value, event, trigger.node),
        ),
      ),
      on("keydown", (event) => {
        if (state.registry.itemAt(event.target) === undefined) return;
        // Enter and Space already reach a native button as a click. Arrow,
        // Home, and End movement is the optional part of the pattern, and it
        // lands on disabled headers so a locked section stays discoverable.
        state.registry.moveFocus(event, {
          loop: false,
          orientation: state.orientation,
        });
      }),
    ],
  }),
);

export const accordionTriggerMixin = /* @__PURE__ */ createMixin(
  (
    context: MixinContext,
    state: AccordionPartState,
    own: AccordionTriggerOwnState,
  ) => {
    expectHost(context, "accordion trigger", "button");
    const disabled = own.disabled || context.props.disabled === true;
    return {
      ...triggerProps(context, { disabled, id: own.triggerId }),
      "aria-controls": own.panelId,
      "aria-expanded": own.open ? "true" : "false",
      bind: bindPart(context, (node, signal) =>
        state.registry.bindItem(node, signal, own.value, disabled),
      ),
      "data-fig-accordion-trigger": "",
      "data-open": own.open ? "" : undefined,
    };
  },
);

export const accordionPanelMixin = /* @__PURE__ */ createMixin(
  (
    context: MixinContext,
    state: AccordionPartState,
    own: AccordionPanelOwnState,
  ) => ({
    "aria-labelledby": own.triggerId,
    bind: bindPart(context, (node, signal) =>
      state.relations.bindPanel(node, signal, own.value),
    ),
    "data-open": own.open ? "" : undefined,
    hidden: own.open ? undefined : true,
    id: context.props.id ?? own.panelId,
    role: "region",
  }),
);
