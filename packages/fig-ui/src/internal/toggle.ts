import {
  createMixin,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { type ChangeDetails, createChangeDetails } from "./changes.ts";
import { assertSinglePart, expectHost } from "./diagnostics.ts";
import { createFormReset } from "./form-reset.ts";
import { bindPart, createPartCollection } from "./parts.ts";
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
      bind: bindPart(context, state.noteInput),
      checked: state.checked,
      "data-checked": state.checked ? "" : undefined,
      "data-disabled": state.disabled ? "" : undefined,
      "data-indeterminate": state.indeterminate ? "" : undefined,
      "data-readonly": state.readOnly ? "" : undefined,
      disabled: state.disabled ? true : undefined,
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
      required: state.required ? true : undefined,
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
  const controlled = options.checked !== undefined;
  const initialChecked = useMemo(() => options.defaultChecked === true, []);
  const [uncontrolled, setUncontrolled] = useState(initialChecked);
  const checked = controlled ? options.checked === true : uncontrolled;
  const requestReconcile = useRegistrationReconcile();
  const input = useMemo(
    () => createPartCollection<undefined>(requestReconcile),
    [],
  );
  const tracker = useMemo(() => ({ checked }), []);
  tracker.checked = checked;

  const reset = useStableEvent(() => {
    const next = controlled ? options.checked === true : initialChecked;
    tracker.checked = next;
    if (controlled) requestReconcile();
    else setUncontrolled(next);
  });
  const formReset = useMemo(() => createFormReset(reset), []);

  const emitCheckedChange = useStableEvent(
    (next: boolean, details: CheckedChangeDetails, signal: AbortSignal) => {
      options.onCheckedChange?.(next, details, signal);
    },
  );

  const toggle = useStableEvent(
    (next: boolean, event: Event, node: Element) => {
      if (next === tracker.checked) return;
      if (readOnly) {
        requestReconcile();
        return;
      }
      const details = createChangeDetails(event, node);
      emitCheckedChange(next, details);
      if (details.isCanceled) {
        requestReconcile();
        return;
      }
      tracker.checked = next;
      // The box is already ticked. When that did not become state, reconcile
      // so the committed props re-assert.
      if (controlled) requestReconcile();
      else setUncontrolled(next);
    },
  );

  const setChecked = useStableEvent((next: boolean) => {
    if (next === tracker.checked) return;
    const details = createChangeDetails(null);
    emitCheckedChange(next, details);
    if (details.isCanceled) return;
    tracker.checked = next;
    if (controlled) requestReconcile();
    else setUncontrolled(next);
  });

  useBeforePaint(() => {
    const inputs = input.items();
    assertSinglePart(inputs, "checkbox or switch control");
    const node = inputs.at(-1)?.node;
    if (node instanceof HTMLInputElement) node.indeterminate = indeterminate;
  });

  const state: ToggleState = {
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
