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
  /** Render the list in document flow instead of the native top layer. */
  inline?: boolean;
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
  readonly inline: boolean;
  readonly automaticLabels: WeakSet<HTMLElement>;
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
  readonly setHighlighted: (value: unknown, scroll: boolean) => void;
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
    const disabled = state.disabled || context.props.disabled === true;
    const readOnly = state.readOnly || context.props.readonly === true;
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
      "aria-readonly": readOnly ? "true" : undefined,
      bind: bindPart(context, state.bindInput),
      "data-open": state.open ? "" : undefined,
      "data-readonly": readOnly ? "" : undefined,
      disabled: disabled ? true : undefined,
      mix: [
        on("click", (event) => {
          if (event.defaultPrevented) return;
          if (!disabled) {
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
          if (event.defaultPrevented) return;
          if (
            disabled ||
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          ) {
            return;
          }
          if (event.key === "Escape" && state.open && !state.inline) {
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
            state.setHighlighted(moved.value, true);
            state.requestOpen(true, event, currentElement(event));
            return;
          }
          if (event.key !== "Enter" || !state.open) return;
          const option = state.registry.option(state.highlighted);
          if (option === undefined) return;
          // Enter means accepting the highlighted option, even when readonly
          // refuses that action. Do not turn it into an implicit form submit.
          event.preventDefault();
          if (!readOnly) state.select(option, event);
        }),
      ],
      readonly: readOnly ? true : undefined,
      role: "combobox",
      value: state.inputValue,
    };
  },
);

const comboboxPopupMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ComboboxState) => {
    expectPopupId(context, state.popupId, "combobox popup");
    const automaticLabel =
      context.props["aria-labelledby"] == null &&
      context.props["aria-label"] === undefined;
    return {
      bind: bindPart(context, (node, signal) => {
        if (
          automaticLabel &&
          context.props["aria-labelledby"] == null &&
          context.props["aria-label"] === undefined
        )
          state.automaticLabels.add(node);
        else state.automaticLabels.delete(node);
        state.bindPopup(node, signal);
        state.registry.bindContainer(node, signal);
      }),
      "data-open": state.open ? "" : undefined,
      id: state.popupId,
      hidden: state.inline ? !state.open : undefined,
      mix: [
        on("beforetoggle", (event) => {
          if (state.inline || event.defaultPrevented) return;
          const next = toggledOpen(event);
          if (
            next !== undefined &&
            !state.requestOpen(next, event, undefined)
          ) {
            event.preventDefault();
          }
        }),
        on("toggle", (event) => {
          if (state.inline) return;
          const next = toggledOpen(event);
          if (next === undefined) return;
          state.requestOpen(next, event, undefined);
        }),
        on("pointerdown", (event) => {
          if (state.registry.optionAt(event.target) !== undefined) {
            event.preventDefault();
          }
        }),
        on("pointermove", (event) => {
          if (event.pointerType === "touch") return;
          const option = state.registry.optionAt(event.target);
          if (option !== undefined && !option.disabled) {
            state.setHighlighted(option.value, false);
          }
        }),
        on("click", (event) => {
          if (event.defaultPrevented) return;
          const option = state.registry.optionAt(event.target);
          if (option === undefined) return;
          if (option.disabled) event.preventDefault();
          else if (event.button === 0) state.select(option, event);
        }),
      ],
      popover: state.inline ? undefined : (context.props.popover ?? "auto"),
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
      type:
        context.type === "button"
          ? (context.props.type ?? "button")
          : undefined,
      tabindex: -1,
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
  const { getOpen, open, requestOpen, setOpen } = useOpenState({
    ...options,
    requestReconcile,
  });
  const id = useId();
  const popupId = options.id ?? `${id}-popup`;
  const anchorName = `--fig-combobox-${id.replaceAll(/[^\w-]/g, "-")}`;
  const idFor = usePartIds();
  const automaticLabels = useMemo(() => new WeakSet<HTMLElement>(), []);
  const trackers = useMemo(
    () => ({
      inputValue,
      value,
      anchored: false,
      scrollTo: undefined as { value: unknown } | undefined,
    }),
    [],
  );
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
  const setHighlighted = useStableEvent((next: unknown, scroll: boolean) => {
    trackers.scrollTo = scroll ? { value: next } : undefined;
    if (!sameValue(highlighted.value, next)) {
      setHighlightedState({ value: next });
    } else if (scroll) requestReconcile();
  });
  const changeInput = useStableEvent(
    (next: string, event: Event, node: HTMLInputElement) => {
      if (
        event.defaultPrevented ||
        disabled ||
        readOnly ||
        inputUnavailable(node)
      ) {
        node.value = trackers.inputValue;
        requestReconcile();
        return;
      }
      if (next === trackers.inputValue) return;
      const details = createChangeDetails(event, node);
      emitInputValueChange(next, details);
      if (trackers.value !== null) emitValueChange(null, details);
      if (details.isCanceled) {
        requestReconcile();
        return;
      }
      if (!controlledInput) trackers.inputValue = next;
      if (!controlledValue) trackers.value = null;
      if (controlledInput) requestReconcile();
      else setUncontrolledInput(next);
      if (controlledValue) requestReconcile();
      else setUncontrolledValue({ value: null });
      requestOpen(true, event, node);
    },
  );
  const select = useStableEvent((option: ListboxOption, event: Event) => {
    if (
      disabled ||
      readOnly ||
      option.disabled ||
      inputUnavailable(popup.anchor())
    )
      return;
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
    if (!controlledValue) trackers.value = nextValue;
    if (!controlledInput) trackers.inputValue = nextInput;
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
    if (options.inline) {
      if (trackers.anchored) {
        popup.anchor()?.style.removeProperty("anchor-name");
        popup.popup()?.style.removeProperty("position-anchor");
        trackers.anchored = false;
      }
    } else {
      popup.sync(getOpen(), anchorName);
      trackers.anchored = true;
    }
    // Read live DOM order once per reconciliation rather than scanning it for
    // each selected/highlighted lookup. Large inline lists reconcile on edits.
    const scrollTo = trackers.scrollTo;
    trackers.scrollTo = undefined;
    const mounted = open ? registry.options() : [];
    const highlightedOption = mounted.find((entry) =>
      sameValue(entry.value, highlighted.value),
    );
    if (open) {
      const selectedOption = mounted.find((entry) =>
        sameValue(entry.value, value),
      );
      const next =
        highlightedOption?.disabled === false
          ? highlighted.value
          : selectedOption?.disabled === false
            ? value
            : (mounted.find((entry) => !entry.disabled)?.value ?? null);
      setHighlighted(next, false);
    }
    // Keyboard navigation keeps virtual focus on the input, so it must scroll
    // the active option explicitly after the popup becomes visible. Pointer
    // highlights never scroll, avoiding hover/scroll feedback.
    if (
      open &&
      scrollTo !== undefined &&
      sameValue(scrollTo.value, highlighted.value) &&
      highlightedOption?.disabled === false
    ) {
      highlightedOption.node.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
      });
    }
    const input = popup.anchor();
    if (input !== undefined) {
      assertControlLabel(input);
      const popupNode = registry.containerNode();
      if (popupNode !== null && automaticLabels.has(popupNode)) {
        const labelledBy = input.getAttribute("aria-labelledby") ?? undefined;
        const label =
          input.getAttribute("aria-label") ??
          (input instanceof HTMLInputElement
            ? [...(input.labels ?? [])]
                .map((label) => label.textContent?.trim())
                .filter(Boolean)
                .join(" ")
            : undefined);
        // Referencing a textbox itself can name the listbox after its current
        // value. Reuse its label sources instead of referencing the control.
        setIdReference(popupNode, "aria-labelledby", labelledBy);
        setIdReference(popupNode, "aria-label", labelledBy ? undefined : label);
      }
      const optionId =
        open && highlighted.value !== null
          ? (highlightedOption?.node.id ?? idFor(highlighted.value, "option"))
          : undefined;
      setIdReference(input, "aria-activedescendant", optionId);
    }
  });

  const getFormValue = options.getFormValue ?? String;
  const state: ComboboxState = {
    inline: options.inline === true,
    automaticLabels,
    bindHiddenInput: formReset.bind,
    bindInput: (node, signal) => {
      popup.bindAnchor(node, signal);
      formReset.bind(node, signal);
    },
    bindPopup: popup.bindPopup,
    disabled,
    formValue: value === null ? "" : getFormValue(value),
    highlighted: highlighted.value,
    idFor,
    input: changeInput,
    inputValue,
    name: options.name,
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

/** Native constraints can come from later mixins or a disabled fieldset. */
function inputUnavailable(node: HTMLElement | undefined): boolean {
  return (
    node instanceof HTMLInputElement &&
    (node.readOnly || node.matches(":disabled"))
  );
}
