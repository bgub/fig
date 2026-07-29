import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { expectHost, expectPopupId } from "../internal/diagnostics.ts";
import { toggledOpen } from "../internal/anchored-popup.ts";
import { bindPart, triggerProps } from "../internal/parts.ts";
import type { PopoverRegistry } from "./registry.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface PopoverPartState {
  readonly open: boolean;
  readonly popoverId: string;
  readonly registry: PopoverRegistry;
  readonly requestOpen: (
    open: boolean,
    event: Event,
    trigger: Element | undefined,
  ) => boolean;
}

export const popoverTriggerMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: PopoverPartState) => {
    expectHost(context, "popover trigger", "button");
    return {
      ...triggerProps(context, { disabled: false }),
      "aria-controls": state.popoverId,
      "aria-expanded": state.open ? "true" : "false",
      bind: bindPart(context, (node, signal) =>
        state.registry.bindTrigger(node, signal),
      ),
      "data-open": state.open ? "" : undefined,
      popovertarget: state.popoverId,
      // With popover support the browser toggles through popovertarget, which
      // works before hydration; without it the widget does the toggling.
      mix: on("click", (event) => {
        if (event.defaultPrevented || state.registry.supported()) return;
        const trigger = event.currentTarget;
        state.requestOpen(
          !state.open,
          event,
          trigger instanceof Element ? trigger : undefined,
        );
      }),
    };
  },
);

export const popoverMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: PopoverPartState) => {
    expectPopupId(context, state.popoverId);
    return {
      bind: bindPart(context, (node, signal) =>
        state.registry.bindPopover(node, signal),
      ),
      "data-open": state.open ? "" : undefined,
      id: state.popoverId,
      mix: [
        // Light dismiss, Escape, and the declarative trigger all arrive here as
        // a cancelable beforetoggle, so a handler can refuse any of them.
        on("beforetoggle", (event) => {
          const next = toggledOpen(event);
          if (next === undefined) return;
          if (!state.requestOpen(next, event, undefined))
            event.preventDefault();
        }),
        on("toggle", (event) => {
          const next = toggledOpen(event);
          if (next === undefined) return;
          state.registry.noteToggle(next);
          state.requestOpen(next, event, undefined);
        }),
      ],
      popover: context.props.popover ?? "auto",
    };
  },
);
