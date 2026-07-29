import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type { Composite, Orientation } from "../internal/composite.ts";
import { expectHost } from "../internal/diagnostics.ts";
import { bindPart } from "../internal/parts.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface RadioGroupPartState {
  readonly bindFormReset: (node: HTMLElement, signal: AbortSignal) => void;
  readonly disabled: boolean;
  readonly name: string;
  readonly orientation: Orientation;
  readonly readOnly: boolean;
  readonly registry: Composite;
  readonly required: boolean;
  readonly select: (value: unknown, event: Event, trigger: Element) => void;
}

interface RadioOwnState {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly value: unknown;
}

export const radioGroupMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: RadioGroupPartState) => ({
    "aria-orientation": state.orientation,
    "aria-readonly": state.readOnly ? "true" : undefined,
    bind: bindPart(context, (node, signal) =>
      state.registry.bindContainer(node, signal),
    ),
    "data-disabled": state.disabled ? "" : undefined,
    "data-orientation": state.orientation,
    "data-readonly": state.readOnly ? "" : undefined,
    // Radios sharing a name give the browser the roving tab stop, arrow
    // movement on both axes, wrapping, skipping disabled, and Space. The
    // group only has to hear what the platform decided.
    mix: [
      on("click", (event) => {
        if (
          state.readOnly &&
          state.registry.itemAt(event.target) !== undefined
        ) {
          event.preventDefault();
        }
      }),
      on("change", (event) => {
        const radio = state.registry.itemAt(event.target);
        if (radio === undefined) return;
        state.select(radio.value, event, radio.node);
      }),
    ],
    role: "radiogroup",
  }),
);

/** Applies to a native `<input type="radio">`, which owns the interaction. */
export const radioMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: RadioGroupPartState, own: RadioOwnState) => {
    expectHost(context, "radio", "input");
    const disabled = own.disabled || context.props.disabled === true;
    return {
      bind: bindPart(context, (node, signal) => {
        state.registry.bindItem(node, signal, own.value, disabled);
        state.bindFormReset(node, signal);
      }),
      checked: own.checked,
      "data-checked": own.checked ? "" : undefined,
      "data-disabled": disabled ? "" : undefined,
      "data-readonly": state.readOnly ? "" : undefined,
      disabled: disabled ? true : undefined,
      name: context.props.name ?? state.name,
      required: state.required ? true : undefined,
      type: "radio",
      // The submitted value is the string form of the identity. Supply a
      // `value` prop when the two should differ.
      value: context.props.value ?? String(own.value),
    };
  },
);
