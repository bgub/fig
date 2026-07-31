import {
  type FigNode,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import {
  createComposite,
  type Orientation,
  sameValue,
} from "../internal/composite.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import { assertAccessibleName } from "../internal/diagnostics.ts";
import { createFormReset } from "../internal/form-reset.ts";
import { radioGroupMixin, radioMixin } from "./parts.ts";

export type RadioGroupOrientation = Orientation;

export type RadioGroupValueChangeDetails = ChangeDetails;

export type RadioGroupValueChangeHandler<Value = unknown> = (
  value: Value | null,
  details: RadioGroupValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface RadioOptions {
  disabled?: boolean;
}

export interface RadioGroupOptions<Value = unknown> {
  defaultValue?: Value | null;
  /** Disables every radio in the group. */
  disabled?: boolean;
  /** The submitted field name. Generated when absent. */
  name?: string;
  onValueChange?: RadioGroupValueChangeHandler<Value>;
  /** Labels the group's axis. Defaults to `vertical`, the ARIA default. */
  orientation?: RadioGroupOrientation;
  /** Prevents user changes while keeping radios focusable and submitted. */
  readOnly?: boolean;
  /** Requires a choice before the form submits. */
  required?: boolean;
  value?: Value | null;
}

export interface RadioGroupParts<Value = unknown> {
  /** The field name every radio shares. */
  readonly name: string;
  readonly value: Value | null;
  /** Applies to a native `<input type="radio">`. */
  radio(value: Value, options?: RadioOptions): MixinDescriptor;
  root(): MixinDescriptor;
}

export interface RadioGroupProps<
  Value = unknown,
> extends RadioGroupOptions<Value> {
  children: (group: RadioGroupParts<Value>) => FigNode;
}

/**
 * Coordinates one radio group over native radio inputs.
 *
 * Radios sharing a name are already a group to the browser, which owns the
 * single tab stop, arrow movement on either axis, wrapping, skipping disabled
 * radios, Space, form submission, and validity. The widget owns the selected
 * value and reports changes, and adds no keyboard handling of its own.
 */
export function useRadioGroup<Value = unknown>(
  options: RadioGroupOptions<Value> = {},
): RadioGroupParts<Value> {
  const {
    disabled = false,
    orientation = "vertical",
    readOnly = false,
    required = false,
  } = options;
  const controlledValue = options.value;
  const controlled = controlledValue !== undefined;
  // Boxed because a value may itself be a function, which useState would
  // otherwise call as an initializer.
  const initialValue = useMemo(
    () => (options.defaultValue === undefined ? null : options.defaultValue),
    [],
  );
  const [uncontrolled, setUncontrolled] = useState<{
    readonly value: Value | null;
  }>(() => ({ value: initialValue }));
  const value =
    controlledValue === undefined ? uncontrolled.value : controlledValue;
  // Registration only: nothing renders from it, so there is nothing to
  // reconcile when a descendant mounts a radio.
  const registry = useMemo(
    () =>
      createComposite({
        container: '[role="radiogroup"]',
        item: 'input[type="radio"]',
        name: "radio group",
      }),
    [],
  );
  useBeforePaint(() => {
    const container = registry.containerNode();
    if (container !== null) assertAccessibleName(container, "radio group");
  });

  const emitChange = useStableEvent(
    (
      next: unknown,
      details: RadioGroupValueChangeDetails,
      signal: AbortSignal,
    ) => {
      options.onValueChange?.(next as Value | null, details, signal);
    },
  );

  const requestReconcile = useRegistrationReconcile();
  const reset = useStableEvent(() => {
    if (controlled) requestReconcile();
    else setUncontrolled({ value: initialValue });
  });
  const formReset = useMemo(() => createFormReset(reset), []);
  const select = useStableEvent(
    (next: unknown, event: Event, trigger: Element) => {
      // Native changes may arrive faster than uncontrolled state commits. A
      // later selection can therefore equal the stale rendered value while an
      // older update is still queued; it must supersede that update rather
      // than being dropped.
      if (controlled && sameValue(next, value)) return;
      if (readOnly) {
        requestReconcile();
        return;
      }
      const details = createChangeDetails(event, trigger);
      emitChange(next, details);
      if (details.isCanceled) {
        requestReconcile();
        return;
      }
      // The browser already moved the checked radio. When that did not turn
      // into a state change — a controlled owner that kept its value, or a
      // handler that refused — reconcile so the committed props re-assert.
      if (controlled) requestReconcile();
      else setUncontrolled({ value: next as Value });
    },
  );

  const id = useId();
  const name = options.name ?? `${id}-radio-group`;
  const state = {
    bindFormReset: formReset.bind,
    disabled,
    name,
    orientation,
    readOnly,
    registry,
    required,
    select,
  };

  return {
    name,
    radio: (radioValue, radioOptions = {}) =>
      radioMixin(state, {
        checked: value !== null && sameValue(radioValue, value),
        disabled: disabled || radioOptions.disabled === true,
        value: radioValue,
      }),
    root: () => radioGroupMixin(state),
    value,
  };
}

/**
 * {@link useRadioGroup} as a component, for a group that is not already a
 * component of its own. Selection re-renders this root rather than the caller.
 */
export function RadioGroup<Value = unknown>(
  props: RadioGroupProps<Value>,
): FigNode {
  return props.children(useRadioGroup(props));
}
