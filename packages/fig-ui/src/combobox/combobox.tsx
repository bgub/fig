import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import {
  createAnchoredPopup,
  toggledOpen,
} from "../internal/anchored-popup.ts";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import { sameValue } from "../internal/composite.ts";
import {
  assertControlLabel,
  expectHost,
  expectPopupId,
} from "../internal/diagnostics.ts";
import { createFormReset } from "../internal/form-reset.ts";
import { usePartIds } from "../internal/ids.ts";
import { createListbox, type ListboxOption } from "../internal/listbox.ts";
import type {
  OpenChangeDetails,
  OpenChangeHandler,
} from "../internal/open-state.ts";
import { useOpenState } from "../internal/open-state.ts";
import { bindPart, setIdReference } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export type ComboboxOpenChangeDetails = OpenChangeDetails;
export type ComboboxOpenChangeHandler = OpenChangeHandler;
export type ComboboxInputValueChangeDetails = ChangeDetails;
export type ComboboxValueChangeDetails = ChangeDetails;

export type ComboboxInputValueChangeHandler = (
  value: string,
  details: ComboboxInputValueChangeDetails,
  signal: AbortSignal,
) => void;

export type ComboboxValueChangeHandler<Value = unknown> = (
  value: Value | null,
  details: ComboboxValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface ComboboxOptionOptions {
  disabled?: boolean;
  /** Text written to the input when this option is selected. */
  textValue?: string;
}

export interface ComboboxOptions<Value = unknown> {
  defaultInputValue?: string;
  defaultOpen?: boolean;
  defaultValue?: Value | null;
  disabled?: boolean;
  /** Converts the selected identity to its submitted value. Defaults to String. */
  getFormValue?: (value: Value) => string;
  id?: string;
  inputValue?: string;
  name?: string;
  onInputValueChange?: ComboboxInputValueChangeHandler;
  onOpenChange?: ComboboxOpenChangeHandler;
  onValueChange?: ComboboxValueChangeHandler<Value>;
  open?: boolean;
  readOnly?: boolean;
  value?: Value | null;
}

export interface ComboboxParts<Value = unknown> {
  readonly inputValue: string;
  readonly open: boolean;
  readonly value: Value | null;
  hiddenInput(): MixinDescriptor;
  input(): MixinDescriptor;
  option(value: Value, options?: ComboboxOptionOptions): MixinDescriptor;
  popup(): MixinDescriptor;
  setOpen(open: boolean): void;
}

export interface ComboboxProps<Value = unknown> extends ComboboxOptions<Value> {
  children: (combobox: ComboboxParts<Value>) => FigNode;
}

type ComboboxRegistry = ReturnType<typeof createListbox>;

interface ComboboxState {
  readonly bindHiddenInput: (node: HTMLElement, signal: AbortSignal) => void;
  readonly bindInput: (node: HTMLElement, signal: AbortSignal) => void;
  readonly bindPopup: (node: HTMLElement, signal: AbortSignal) => void;
  readonly disabled: boolean;
  readonly formValue: string;
  readonly highlighted: unknown;
  readonly idFor: (value: unknown, part: string) => string;
  readonly input: (value: string, event: Event, node: HTMLInputElement) => void;
  readonly inputValue: string;
  readonly name: string | undefined;
  readonly noteToggle: (open: boolean) => void;
  readonly open: boolean;
  readonly popupId: string;
  readonly readOnly: boolean;
  readonly registry: ComboboxRegistry;
  readonly requestOpen: (
    open: boolean,
    event: Event,
    trigger: Element | undefined,
  ) => boolean;
  readonly select: (option: ListboxOption, event: Event) => void;
  readonly setHighlighted: (value: unknown) => void;
  readonly setOpen: (open: boolean) => void;
}

interface ComboboxOptionState {
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly textValue: string | undefined;
  readonly value: unknown;
}

const comboboxInputMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ComboboxState) => {
    expectHost(context, "combobox input", "input");
    return {
      "aria-activedescendant":
        state.open && state.highlighted !== null
          ? (state.registry.option(state.highlighted)?.node.id ??
            state.idFor(state.highlighted, "option"))
          : undefined,
      "aria-autocomplete": "list",
      "aria-controls": state.popupId,
      "aria-expanded": state.open ? "true" : "false",
      "aria-haspopup": "listbox",
      "aria-readonly": state.readOnly ? "true" : undefined,
      bind: bindPart(context, state.bindInput),
      "data-open": state.open ? "" : undefined,
      "data-readonly": state.readOnly ? "" : undefined,
      disabled: state.disabled ? true : undefined,
      mix: [
        on("click", (event) => {
          if (!state.disabled) {
            state.requestOpen(true, event, currentElement(event));
          }
        }),
        on("focusout", (event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Node &&
            state.registry.containerNode()?.contains(next)
          ) {
            return;
          }
          state.requestOpen(false, event, currentElement(event));
        }),
        on("input", (event) => {
          const node = event.currentTarget;
          if (node instanceof HTMLInputElement) {
            state.input(node.value, event, node);
          }
        }),
        on("keydown", (event) => {
          if (
            state.disabled ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          ) {
            return;
          }
          if (event.key === "Escape" && state.open) {
            event.preventDefault();
            state.requestOpen(false, event, currentElement(event));
            return;
          }
          const moved =
            event.key === "ArrowDown" || event.key === "ArrowUp"
              ? state.registry.move(state.highlighted, event.key)
              : undefined;
          if (moved !== undefined) {
            event.preventDefault();
            state.setHighlighted(moved.value);
            state.requestOpen(true, event, currentElement(event));
            return;
          }
          if (event.key !== "Enter" || !state.open) return;
          const option = state.registry.option(state.highlighted);
          if (option === undefined || state.readOnly) return;
          event.preventDefault();
          state.select(option, event);
        }),
      ],
      readonly: state.readOnly ? true : undefined,
      role: "combobox",
      value: state.inputValue,
    };
  },
);

const comboboxPopupMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ComboboxState) => {
    expectPopupId(context, state.popupId, "combobox popup");
    return {
      bind: bindPart(context, (node, signal) => {
        state.bindPopup(node, signal);
        state.registry.bindContainer(node, signal);
      }),
      "data-open": state.open ? "" : undefined,
      id: state.popupId,
      mix: [
        on("beforetoggle", (event) => {
          const next = toggledOpen(event);
          if (
            next !== undefined &&
            !state.requestOpen(next, event, undefined)
          ) {
            event.preventDefault();
          }
        }),
        on("toggle", (event) => {
          const next = toggledOpen(event);
          if (next === undefined) return;
          state.noteToggle(next);
          state.requestOpen(next, event, undefined);
        }),
        on("pointerdown", (event) => {
          if (state.registry.optionAt(event.target) !== undefined) {
            event.preventDefault();
          }
        }),
        on("pointermove", (event) => {
          const option = state.registry.optionAt(event.target);
          if (option !== undefined && !option.disabled) {
            state.setHighlighted(option.value);
          }
        }),
        on("click", (event) => {
          const option = state.registry.optionAt(event.target);
          if (option === undefined) return;
          if (option.disabled) event.preventDefault();
          else if (event.button === 0) state.select(option, event);
        }),
      ],
      popover: context.props.popover ?? "auto",
      role: "listbox",
    };
  },
);

const comboboxOptionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ComboboxState, own: ComboboxOptionState) => {
    const disabled = own.disabled || context.props.disabled === true;
    return {
      "aria-disabled": disabled ? "true" : undefined,
      "aria-selected": own.selected ? "true" : "false",
      bind: bindPart(context, (node, signal) =>
        state.registry.bindOption(node, signal, {
          disabled,
          textValue: own.textValue,
          value: own.value,
        }),
      ),
      "data-disabled": disabled ? "" : undefined,
      "data-highlighted": sameValue(state.highlighted, own.value)
        ? ""
        : undefined,
      "data-selected": own.selected ? "" : undefined,
      id: context.props.id ?? state.idFor(own.value, "option"),
      role: "option",
    };
  },
);

const comboboxHiddenInputMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ComboboxState) => {
    expectHost(context, "combobox hidden input", "input");
    return {
      bind: bindPart(context, state.bindHiddenInput),
      disabled: state.disabled ? true : undefined,
      name: context.props.name ?? state.name,
      type: "hidden",
      value: context.props.value ?? state.formValue,
    };
  },
);

/** Coordinates an editable input with a caller-filtered listbox popup. */
export function useCombobox<Value = unknown>(
  options: ComboboxOptions<Value> = {},
): ComboboxParts<Value> {
  const { disabled = false, readOnly = false } = options;
  const controlledValue = options.value !== undefined;
  const controlledInput = options.inputValue !== undefined;
  const initialValue = useMemo(() => options.defaultValue ?? null, []);
  const initialInputValue = useMemo(() => options.defaultInputValue ?? "", []);
  const [uncontrolledValue, setUncontrolledValue] = useState<{
    readonly value: Value | null;
  }>(() => ({ value: initialValue }));
  const [uncontrolledInput, setUncontrolledInput] = useState(initialInputValue);
  const value = controlledValue
    ? (options.value ?? null)
    : uncontrolledValue.value;
  const inputValue = controlledInput
    ? (options.inputValue ?? "")
    : uncontrolledInput;
  const [highlighted, setHighlightedState] = useState<{
    readonly value: unknown;
  }>(() => ({ value }));
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () => createListbox("combobox", requestReconcile),
    [],
  );
  const popup = useMemo(
    () => createAnchoredPopup(requestReconcile, "combobox"),
    [],
  );
  const { open, requestOpen, setOpen } = useOpenState({
    ...options,
    requestReconcile,
  });
  const id = useId();
  const popupId = options.id ?? `${id}-popup`;
  const anchorName = `--fig-combobox-${id.replaceAll(/[^\w-]/g, "-")}`;
  const idFor = usePartIds();
  const trackers = useMemo(() => ({ inputValue, value }), []);
  trackers.inputValue = inputValue;
  trackers.value = value;

  const emitInputValueChange = useStableEvent(
    (next: string, details: ChangeDetails, signal: AbortSignal) => {
      options.onInputValueChange?.(next, details, signal);
    },
  );
  const emitValueChange = useStableEvent(
    (next: Value | null, details: ChangeDetails, signal: AbortSignal) => {
      options.onValueChange?.(next, details, signal);
    },
  );
  const setHighlighted = useStableEvent((next: unknown) => {
    if (!sameValue(highlighted.value, next)) {
      setHighlightedState({ value: next });
    }
  });
  const changeInput = useStableEvent(
    (next: string, event: Event, node: HTMLInputElement) => {
      if (disabled || readOnly || next === trackers.inputValue) return;
      const details = createChangeDetails(event, node);
      emitInputValueChange(next, details);
      if (trackers.value !== null) emitValueChange(null, details);
      if (details.isCanceled) {
        requestReconcile();
        return;
      }
      trackers.inputValue = next;
      trackers.value = null;
      if (controlledInput) requestReconcile();
      else setUncontrolledInput(next);
      if (controlledValue) requestReconcile();
      else setUncontrolledValue({ value: null });
      requestOpen(true, event, node);
    },
  );
  const select = useStableEvent((option: ListboxOption, event: Event) => {
    if (disabled || readOnly || option.disabled) return;
    const nextValue = option.value as Value;
    const nextInput = option.textValue ?? option.node.textContent?.trim() ?? "";
    const details = createChangeDetails(event, option.node);
    if (!sameValue(trackers.value, nextValue)) {
      emitValueChange(nextValue, details);
    }
    if (nextInput !== trackers.inputValue) {
      emitInputValueChange(nextInput, details);
    }
    if (details.isCanceled) {
      requestReconcile();
      return;
    }
    trackers.value = nextValue;
    trackers.inputValue = nextInput;
    if (controlledValue || controlledInput) requestReconcile();
    if (!controlledValue) setUncontrolledValue({ value: nextValue });
    if (!controlledInput) setUncontrolledInput(nextInput);
    setOpen(false);
  });
  const reset = useStableEvent(() => {
    trackers.value = controlledValue ? (options.value ?? null) : initialValue;
    trackers.inputValue = controlledInput
      ? (options.inputValue ?? "")
      : initialInputValue;
    if (controlledValue || controlledInput) requestReconcile();
    if (!controlledValue) setUncontrolledValue({ value: initialValue });
    if (!controlledInput) setUncontrolledInput(initialInputValue);
  });
  const formReset = useMemo(() => createFormReset(reset), []);

  useBeforePaint(() => {
    popup.sync(open, anchorName);
    if (open) {
      const mounted = registry.options();
      const next =
        registry.option(highlighted.value)?.disabled === false
          ? highlighted.value
          : registry.option(value)?.disabled === false
            ? value
            : (mounted.find((entry) => !entry.disabled)?.value ?? null);
      setHighlighted(next);
    }
    const input = popup.anchor();
    if (input !== undefined) {
      assertControlLabel(input);
      const optionId =
        open && highlighted.value !== null
          ? (registry.option(highlighted.value)?.node.id ??
            idFor(highlighted.value, "option"))
          : undefined;
      setIdReference(input, "aria-activedescendant", optionId);
    }
  });

  const getFormValue = options.getFormValue ?? String;
  const state: ComboboxState = {
    bindHiddenInput: formReset.bind,
    bindInput: popup.bindAnchor,
    bindPopup: popup.bindPopup,
    disabled,
    formValue: value === null ? "" : getFormValue(value),
    highlighted: highlighted.value,
    idFor,
    input: changeInput,
    inputValue,
    name: options.name,
    noteToggle: popup.noteToggle,
    open,
    popupId,
    readOnly,
    registry,
    requestOpen,
    select,
    setHighlighted,
    setOpen,
  };

  return {
    hiddenInput: () => comboboxHiddenInputMixin(state),
    input: () => comboboxInputMixin(state),
    inputValue,
    open,
    option: (optionValue, optionOptions = {}) =>
      comboboxOptionMixin(state, {
        disabled: optionOptions.disabled === true,
        selected: value !== null && sameValue(value, optionValue),
        textValue: optionOptions.textValue,
        value: optionValue,
      }),
    popup: () => comboboxPopupMixin(state),
    setOpen,
    value,
  };
}

/** {@link useCombobox} as a render-callback component. */
export function Combobox<Value = unknown>(
  props: ComboboxProps<Value>,
): FigNode {
  return props.children(useCombobox(props));
}

function currentElement(event: Event): Element | undefined {
  return event.currentTarget instanceof Element
    ? event.currentTarget
    : undefined;
}
