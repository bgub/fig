import {
  createMixin,
  type FigNode,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import {
  assertControlLabel,
  assertSinglePart,
  expectHost,
} from "../internal/diagnostics.ts";
import { createFormReset } from "../internal/form-reset.ts";
import { bindPart, createPartCollection } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export type SliderValueChangeDetails = ChangeDetails;
export type SliderValueCommitDetails = Pick<ChangeDetails, "event" | "trigger">;
export type SliderValueChangeHandler = (
  value: number,
  details: SliderValueChangeDetails,
  signal: AbortSignal,
) => void;
export type SliderValueCommitHandler = (
  value: number,
  details: SliderValueCommitDetails,
  signal: AbortSignal,
) => void;

export interface SliderOptions {
  value?: number;
  /** Defaults to the native range midpoint, snapped to step. */
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  onValueChange?: SliderValueChangeHandler;
  /** Reports a native change after accepted input; does not undo earlier input. */
  onValueCommit?: SliderValueCommitHandler;
}

export interface SliderParts {
  readonly value: number;
  /** Applies to one native input range. Label it with a label or ARIA. */
  control(): MixinDescriptor;
  setValue(value: number): void;
}

export interface SliderProps extends SliderOptions {
  children: (slider: SliderParts) => FigNode;
}

interface SliderState {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number | "any";
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly name: string | undefined;
  readonly bind: (node: HTMLElement, signal: AbortSignal) => void;
  readonly input: (
    node: HTMLInputElement,
    event: Event,
    commit: boolean,
  ) => void;
}

const mutatingKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const sliderControl = /* @__PURE__ */ createMixin(
  (context, state: SliderState) => {
    expectHost(context, "slider control", "input");
    const readOnly = state.readOnly || context.props.readonly === true;
    return {
      bind: bindPart(context, state.bind),
      type: "range",
      min: state.min,
      max: state.max,
      step: state.step,
      value: state.value,
      name: context.props.name ?? state.name,
      disabled: state.disabled ? true : context.props.disabled,
      "data-disabled":
        state.disabled || context.props.disabled === true ? "" : undefined,
      "data-readonly": readOnly ? "" : undefined,
      "aria-readonly": readOnly ? "true" : undefined,
      readonly: readOnly ? true : undefined,
      mix: [
        on("keydown", (event) => {
          if (readOnly && mutatingKeys.has(event.key)) event.preventDefault();
        }),
        on("pointerdown", (event) => {
          if (!readOnly || event.defaultPrevented || event.button !== 0) return;
          event.preventDefault();
          if (
            event.currentTarget instanceof HTMLInputElement &&
            !event.currentTarget.matches(":disabled")
          ) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }),
        on("input", (event) => {
          if (event.currentTarget instanceof HTMLInputElement)
            state.input(event.currentTarget, event, false);
        }),
        on("change", (event) => {
          if (event.currentTarget instanceof HTMLInputElement)
            state.input(event.currentTarget, event, true);
        }),
      ],
    };
  },
);

/** Single-thumb range using native pointer, keyboard, focus and form behavior. */
export function useSlider(options: SliderOptions = {}): SliderParts {
  const min =
    options.min !== undefined && Number.isFinite(options.min) ? options.min : 0;
  const max =
    options.max !== undefined && Number.isFinite(options.max)
      ? options.max
      : 100;
  const step =
    options.step === "any"
      ? "any"
      : options.step !== undefined &&
          Number.isFinite(options.step) &&
          options.step > 0
        ? options.step
        : 1;
  const initialValue = useMemo(() => options.defaultValue, []);
  const controlled = options.value !== undefined;
  const [uncontrolled, setUncontrolled] = useState(initialValue);
  const value = sanitize(
    controlled ? options.value : uncontrolled,
    min,
    max,
    step,
  );
  const requestReconcile = useRegistrationReconcile();
  const inputs = useMemo(
    () => createPartCollection<undefined>(requestReconcile),
    [],
  );
  const tracker = useMemo(
    () => ({ value, pending: undefined as number | undefined }),
    [],
  );
  tracker.value = value;

  const emitChange = useStableEvent(
    (next: number, details: SliderValueChangeDetails, signal: AbortSignal) => {
      options.onValueChange?.(next, details, signal);
    },
  );
  const emitCommit = useStableEvent(
    (next: number, details: SliderValueCommitDetails, signal: AbortSignal) => {
      options.onValueCommit?.(next, details, signal);
    },
  );
  const requestValue = useStableEvent(
    (next: number, event: Event | null, node?: HTMLInputElement): boolean => {
      if (next === tracker.value) return true;
      const details = createChangeDetails(event, node);
      emitChange(next, details);
      if (details.isCanceled) return false;
      if (!controlled) {
        tracker.value = next;
        setUncontrolled(next);
      }
      return true;
    },
  );
  const input = useStableEvent(
    (node: HTMLInputElement, event: Event, commit: boolean) => {
      if (
        event.defaultPrevented ||
        node.matches(":disabled") ||
        node.readOnly ||
        options.readOnly
      ) {
        node.value = String(tracker.value);
        if (commit) tracker.pending = undefined;
        return;
      }
      const next = sanitize(node.valueAsNumber, min, max, step);
      const changed = next !== tracker.value;
      // Native input and change may arrive before the owner rerenders.
      // The input request has already been accepted; committing it is not
      // a second value change.
      const accepted =
        (commit && tracker.pending === next) || requestValue(next, event, node);
      if (accepted && changed) tracker.pending = next;
      if (!accepted) node.value = String(tracker.value);
      // Reconciliation restores refused controlled input after the owner has
      // had a chance to commit its update, without corrupting a native change
      // event following input in the same batch.
      if (!accepted || controlled) requestReconcile();
      if (commit) {
        if (accepted && tracker.pending === next) {
          tracker.pending = undefined;
          emitCommit(next, { event, trigger: node });
        } else tracker.pending = undefined;
      }
    },
  );
  const reset = useStableEvent(() => {
    tracker.pending = undefined;
    if (!controlled) setUncontrolled(initialValue);
    requestReconcile();
  });
  const formReset = useMemo(() => createFormReset(reset), []);
  useBeforePaint(() => {
    const controls = inputs.items();
    assertSinglePart(controls, "slider control");
    for (const { node } of controls) assertControlLabel(node);
  });

  const state: SliderState = {
    value,
    min,
    max,
    step,
    disabled: options.disabled === true,
    readOnly: options.readOnly === true,
    name: options.name,
    bind: (node, signal) => {
      inputs.bind(node, signal, undefined);
      formReset.bind(node, signal);
    },
    input,
  };
  const setValue = useStableEvent((next: number) => {
    const normalized = sanitize(next, min, max, step);
    const changed = normalized !== tracker.value;
    if (requestValue(normalized, null) && changed) tracker.pending = undefined;
    if (controlled) requestReconcile();
  });
  return { value, control: () => sliderControl(state), setValue };
}

export function Slider(props: SliderProps): FigNode {
  return props.children(useSlider(props));
}

/** Native range normalization with an explicit min (also the step base). */
function sanitize(
  value: number | undefined,
  min: number,
  max: number,
  step: number | "any",
): number {
  if (max <= min) return min;
  const midpoint = min / 2 + max / 2;
  const finiteValue =
    value !== undefined && Number.isFinite(value) ? value : midpoint;
  const clamped = Math.max(min, Math.min(max, finiteValue));
  if (step === "any") return clamped;
  const distance = clamped - min;
  const steps = Number.isFinite(distance)
    ? distance / step
    : clamped / step - min / step;
  // Beyond safe integer precision the step is smaller than representable changes.
  if (!Number.isSafeInteger(Math.floor(steps))) return clamped;
  let count = Math.round(
    steps + Math.min(1e-7, Number.EPSILON * Math.abs(steps)),
  );
  const tolerance = Math.min(
    step * 1e-7,
    Number.EPSILON * Math.max(Math.abs(min), Math.abs(max), Math.abs(step)) * 2,
  );
  if (stepValue(min, step, count) - max > tolerance) count -= 1;
  const snapped = stepValue(min, step, count);
  // Remove decimal arithmetic noise without losing significant fractional digits.
  const places = Math.max(decimalPlaces(min), decimalPlaces(step));
  const rounded = places <= 100 ? Number(snapped.toFixed(places)) : snapped;
  return Math.max(min, Math.min(max, rounded));
}

function decimalPlaces(value: number): number {
  const [mantissa = "", exponent = "0"] = String(value).split("e");
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
}

/** Avoid overflowing the intermediate product when min and max straddle zero. */
function stepValue(min: number, step: number, count: number): number {
  const offset = count * step;
  return Number.isFinite(offset) ? min + offset : (min / step + count) * step;
}
