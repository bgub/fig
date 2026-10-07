import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { expectHost, expectPopupId } from "../internal/diagnostics.ts";
import { bindPart, triggerProps } from "../internal/parts.ts";
import type { PopoverRegistry } from "./registry.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface PopoverPartState {
  readonly nativeToggle: (event: Event) => void;
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
      bind: bindPart(context, state.registry, state.registry.bindAnchor),
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
      bind: bindPart(context, state.registry, state.registry.bindPopup),
      "data-open": state.open ? "" : undefined,
      id: state.popoverId,
      mix: [
        on("beforetoggle", state.nativeToggle),
        on("toggle", state.nativeToggle),
      ],
      popover: context.props.popover ?? "auto",
    };
  },
);
