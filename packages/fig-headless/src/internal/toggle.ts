import {
  createMixin,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { type ChangeDetails, createChangeDetails } from "./changes.ts";
import { useControllableValue } from "./controllable-value.ts";
import { assertSinglePart, expectHost } from "./diagnostics.ts";
import { createFormReset } from "./form-reset.ts";
import { bindPart } from "./parts.ts";
import { createPartCollection } from "./registration.ts";
import { useRegistrationReconcile } from "./reconcile.ts";

export type CheckedChangeDetails = ChangeDetails;

export type CheckedChangeHandler = (
  checked: boolean,
  details: CheckedChangeDetails,
  signal: AbortSignal,
) => void;

export interface ToggleControlOptions {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  /**
   * Neither checked nor unchecked. The platform has no attribute for it, so
   * this is the one part of the control the widget must write itself.
   */
  indeterminate?: boolean;
  name?: string;
  onCheckedChange?: CheckedChangeHandler;
  /** Prevents user changes while keeping the control focusable and submitted. */
  readOnly?: boolean;
  required?: boolean;
  value?: string;
}

export interface ToggleControlParts {
  readonly checked: boolean;
  /** Applies to a native `<input type="checkbox">`. */
  control(): MixinDescriptor;
  setChecked(checked: boolean): void;
}

interface ToggleState {
  readonly owner: object;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly indeterminate: boolean;
  readonly name: string | undefined;
  readonly noteInput: (node: HTMLElement, signal: AbortSignal) => void;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly role: "switch" | undefined;
  readonly toggle: (checked: boolean, event: Event, node: Element) => void;
  readonly value: string | undefined;
}

const toggleMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToggleState) => {
    expectHost(
      context,
      state.role === "switch" ? "switch control" : "checkbox control",
      "input",
    );
    return {
      bind: bindPart(context, state.owner, state.noteInput),
      checked: state.checked,
      "data-checked": state.checked ? "" : undefined,
      "data-disabled":
        state.disabled || context.props.disabled === true ? "" : undefined,
      "data-indeterminate": state.indeterminate ? "" : undefined,
      "data-readonly": state.readOnly ? "" : undefined,
      disabled: state.disabled ? true : context.props.disabled,
      // The browser has already toggled by the time this runs, so the control
      // reports what happened rather than deciding it.
      mix: [
        on("click", (event) => {
          if (state.readOnly) event.preventDefault();
        }),
        on("change", (event) => {
          const node = event.currentTarget;
          if (node instanceof HTMLInputElement) {
            state.toggle(node.checked, event, node);
          }
        }),
      ],
      name: context.props.name ?? state.name,
      "aria-readonly": state.readOnly ? "true" : undefined,
      required: state.required ? true : context.props.required,
      role: state.role,
      type: "checkbox",
      value: context.props.value ?? state.value,
    };
  },
);

/**
 * A native checkbox, shared by the checkbox and the switch.
 *
 * The platform owns toggling, focus, Space, form submission, and validity.
 * The widget owns the checked value it reports, and writes `indeterminate`,
 * which exists only as a property.
 */
export function useToggleControl(
  options: ToggleControlOptions,
  role: "switch" | undefined,
): ToggleControlParts {
  const {
    disabled = false,
    indeterminate = false,
    readOnly = false,
    required = false,
  } = options;
  const requestReconcile = useRegistrationReconcile();
  const stateValue = useControllableValue({
    value: options.checked,
    defaultValue: options.defaultChecked === true,
    onChange: options.onCheckedChange,
    reconcile: requestReconcile,
  });
  const checked = stateValue.value;
  const input = useMemo(
    () => createPartCollection<undefined>(requestReconcile),
    [],
  );
  const formReset = useMemo(() => createFormReset(stateValue.reset), []);

  const toggle = useStableEvent(
    (next: boolean, event: Event, node: Element) => {
      if (
        event.defaultPrevented ||
        disabled ||
        node.matches(":disabled") ||
        readOnly
      ) {
        requestReconcile();
        return;
      }
      stateValue.request(() => next, createChangeDetails(event, node));
    },
  );

  const setChecked = useStableEvent((next: boolean) => {
    stateValue.request(() => next, createChangeDetails(null));
  });

  useBeforePaint(() => {
    const inputs = input.items();
    assertSinglePart(inputs, "checkbox or switch control");
    const node = inputs.at(-1)?.node;
    if (node instanceof HTMLInputElement) node.indeterminate = indeterminate;
  });

  const state: ToggleState = {
    owner: input,
    checked,
    disabled,
    indeterminate,
    name: options.name,
    noteInput: (node, signal) => {
      input.bind(node, signal, undefined);
      formReset.bind(node, signal);
    },
    readOnly,
    required,
    role,
    toggle,
    value: options.value,
  };

  return {
    checked,
    control: () => toggleMixin(state),
    setChecked,
  };
}
