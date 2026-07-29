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
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import { sameValue } from "../internal/composite.ts";
import { expectHost } from "../internal/diagnostics.ts";
import { createFormReset } from "../internal/form-reset.ts";
import { usePartIds } from "../internal/ids.ts";
import { createListbox, type ListboxOption } from "../internal/listbox.ts";
import {
  bindPart,
  createPartSlot,
  setIdReference,
  triggerProps,
} from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import type {
  PopoverOpenChangeDetails,
  PopoverOpenChangeHandler,
  PopoverParts,
} from "../popover/popover.tsx";
import { usePopover } from "../popover/popover.tsx";

export type SelectOpenChangeDetails = PopoverOpenChangeDetails;
export type SelectOpenChangeHandler = PopoverOpenChangeHandler;
export type SelectValueChangeDetails = ChangeDetails;

export type SelectValueChangeHandler<Value = unknown> = (
  value: Value | null,
  details: SelectValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface SelectOptionOptions {
  disabled?: boolean;
  /** Text used for typeahead when it differs from the host's text content. */
  textValue?: string;
}

export interface SelectOptions<Value = unknown> {
  defaultOpen?: boolean;
  defaultValue?: Value | null;
  disabled?: boolean;
  /** Converts the selected identity to its submitted value. Defaults to String. */
  getFormValue?: (value: Value) => string;
  id?: string;
  name?: string;
  onOpenChange?: SelectOpenChangeHandler;
  onValueChange?: SelectValueChangeHandler<Value>;
  open?: boolean;
  readOnly?: boolean;
  value?: Value | null;
}

export interface SelectParts<Value = unknown> {
  readonly open: boolean;
  readonly value: Value | null;
  hiddenInput(): MixinDescriptor;
  option(value: Value, options?: SelectOptionOptions): MixinDescriptor;
  popup(): MixinDescriptor;
  setOpen(open: boolean): void;
  trigger(): MixinDescriptor;
}

export interface SelectProps<Value = unknown> extends SelectOptions<Value> {
  children: (select: SelectParts<Value>) => FigNode;
}

type SelectRegistry = ReturnType<typeof createListbox>;

interface SelectState {
  readonly bindHiddenInput: (node: HTMLElement, signal: AbortSignal) => void;
  readonly bindTrigger: (node: HTMLElement, signal: AbortSignal) => void;
  readonly disabled: boolean;
  readonly formValue: string;
  readonly highlighted: unknown;
  readonly idFor: (value: unknown, part: string) => string;
  readonly name: string | undefined;
  readonly open: boolean;
  readonly popover: PopoverParts;
  readonly readOnly: boolean;
  readonly registry: SelectRegistry;
  readonly select: (option: ListboxOption, event: Event) => void;
  readonly setHighlighted: (value: unknown) => void;
  readonly triggerId: string;
}

interface SelectOptionState {
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly textValue: string | undefined;
  readonly value: unknown;
}

const selectTriggerBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SelectState) => ({
    ...triggerProps(context, { disabled: state.disabled, id: state.triggerId }),
    "aria-activedescendant":
      state.open && state.highlighted !== null
        ? (state.registry.option(state.highlighted)?.node.id ??
          state.idFor(state.highlighted, "option"))
        : undefined,
    "aria-haspopup": "listbox",
    "aria-readonly": state.readOnly ? "true" : undefined,
    "data-readonly": state.readOnly ? "" : undefined,
    disabled: state.disabled ? true : undefined,
    bind: bindPart(context, state.bindTrigger),
    mix: on("keydown", (event) => {
      if (
        state.disabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const moved = state.registry.move(state.highlighted, event.key);
      if (moved !== undefined) {
        event.preventDefault();
        state.setHighlighted(moved.value);
        if (!state.open) state.popover.setOpen(true);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!state.open) {
          state.popover.setOpen(true);
          return;
        }
        const highlighted = state.registry.option(state.highlighted);
        if (highlighted !== undefined && !state.readOnly) {
          state.select(highlighted, event);
        }
        return;
      }
      const match = state.registry.typeahead(state.highlighted, event.key);
      if (match === undefined) return;
      state.setHighlighted(match.value);
      if (!state.open && !state.readOnly) state.select(match, event);
    }),
    role: "combobox",
  }),
);

const selectTriggerMixin = /* @__PURE__ */ createMixin(
  (
    _context: MixinContext,
    state: SelectState,
    popoverTrigger: MixinDescriptor,
  ) => [popoverTrigger, selectTriggerBehavior(state)],
);

const selectPopupBehavior = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SelectState) => ({
    "aria-labelledby": context.props["aria-labelledby"] ?? state.triggerId,
    bind: bindPart(context, state.registry.bindContainer),
    mix: [
      on("pointerdown", (event) => {
        if (state.registry.optionAt(event.target) !== undefined) {
          event.preventDefault();
        }
      }),
      on("click", (event) => {
        const option = state.registry.optionAt(event.target);
        if (option === undefined) return;
        if (option.disabled) event.preventDefault();
        else if (event.button === 0) state.select(option, event);
      }),
      on("pointermove", (event) => {
        const option = state.registry.optionAt(event.target);
        if (option !== undefined && !option.disabled) {
          state.setHighlighted(option.value);
        }
      }),
    ],
    role: "listbox",
  }),
);

const selectPopupMixin = /* @__PURE__ */ createMixin(
  (
    _context: MixinContext,
    state: SelectState,
    popoverPopup: MixinDescriptor,
  ) => [popoverPopup, selectPopupBehavior(state)],
);

const selectOptionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SelectState, own: SelectOptionState) => {
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

const selectHiddenInputMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: SelectState) => {
    expectHost(context, "select hidden input", "input");
    return {
      disabled: state.disabled ? true : undefined,
      name: context.props.name ?? state.name,
      type: "hidden",
      value: context.props.value ?? state.formValue,
      bind: bindPart(context, state.bindHiddenInput),
    };
  },
);

/** Coordinates a custom select whose trigger, popup, and options are authored. */
export function useSelect<Value = unknown>(
  options: SelectOptions<Value> = {},
): SelectParts<Value> {
  const { disabled = false, readOnly = false } = options;
  const controlledValue = options.value;
  const controlled = controlledValue !== undefined;
  const explicitDefault = options.defaultValue !== undefined;
  const [uncontrolled, setUncontrolled] = useState<{
    readonly value: Value | null;
  }>(() => ({ value: options.defaultValue ?? null }));
  const value =
    controlledValue === undefined ? uncontrolled.value : controlledValue;
  const [highlighted, setHighlightedState] = useState<{
    readonly value: unknown;
  }>(() => ({ value }));
  const registrationChanged = useRegistrationReconcile();
  const registry = useMemo(
    () => createListbox("select", registrationChanged),
    [],
  );
  const popover = usePopover({
    defaultOpen: options.defaultOpen,
    id: options.id,
    onOpenChange: options.onOpenChange,
    open: options.open,
  });
  const trigger = useMemo(() => createPartSlot(registrationChanged), []);
  const initialValue = useMemo(() => options.defaultValue ?? null, []);
  const reset = useStableEvent(() => {
    if (controlled) registrationChanged();
    else setUncontrolled({ value: initialValue });
  });
  const formReset = useMemo(() => createFormReset(reset), []);
  const emitChange = useStableEvent(
    (next: unknown, details: SelectValueChangeDetails, signal: AbortSignal) => {
      options.onValueChange?.(next as Value | null, details, signal);
    },
  );
  const select = useStableEvent((option: ListboxOption, event: Event) => {
    if (disabled || readOnly) return;
    if (sameValue(option.value, value)) {
      popover.setOpen(false);
      return;
    }
    const details = createChangeDetails(event, option.node);
    emitChange(option.value, details);
    if (details.isCanceled) return;
    if (!controlled) setUncontrolled({ value: option.value as Value });
    popover.setOpen(false);
  });
  const setHighlighted = useStableEvent((next: unknown) => {
    if (!sameValue(highlighted.value, next)) {
      setHighlightedState({ value: next });
    }
  });

  useBeforePaint(() => {
    const mounted = registry.options();
    if (!controlled && mounted.length > 0) {
      const selected = value === null ? undefined : registry.option(value);
      const shouldRepair =
        (value !== null && selected === undefined) ||
        (value === null && !explicitDefault);
      if (shouldRepair) {
        const fallback = mounted.find((entry) => !entry.disabled);
        if (fallback !== undefined) {
          const details = createChangeDetails(null);
          emitChange(fallback.value, details);
          if (!details.isCanceled) {
            setUncontrolled({ value: fallback.value as Value });
            setHighlighted(fallback.value);
          }
        }
      }
    }
    if (popover.open) {
      const next =
        registry.option(highlighted.value)?.disabled === false
          ? highlighted.value
          : registry.option(value)?.disabled === false
            ? value
            : (mounted.find((entry) => !entry.disabled)?.value ?? null);
      setHighlighted(next);
    }
    const triggerNode = trigger.node();
    const popupNode = registry.containerNode();
    if (triggerNode !== null && popupNode !== null) {
      if (popupNode.getAttribute("aria-labelledby") === triggerId) {
        setIdReference(popupNode, "aria-labelledby", triggerNode.id);
      }
      const optionId =
        popover.open && highlighted.value !== null
          ? (registry.option(highlighted.value)?.node.id ??
            idFor(highlighted.value, "option"))
          : undefined;
      setIdReference(triggerNode, "aria-activedescendant", optionId);
    }
  });

  const id = useId();
  const triggerId = `${id}-trigger`;
  const idFor = usePartIds();
  const getFormValue = options.getFormValue ?? String;
  const state: SelectState = {
    bindHiddenInput: formReset.bind,
    bindTrigger: trigger.bind,
    disabled,
    formValue: value === null ? "" : getFormValue(value),
    highlighted: highlighted.value,
    idFor,
    name: options.name,
    open: popover.open,
    popover,
    readOnly,
    registry,
    select,
    setHighlighted,
    triggerId,
  };

  return {
    hiddenInput: () => selectHiddenInputMixin(state),
    open: popover.open,
    option: (optionValue, optionOptions = {}) =>
      selectOptionMixin(state, {
        disabled: optionOptions.disabled === true,
        selected: value !== null && sameValue(value, optionValue),
        textValue: optionOptions.textValue,
        value: optionValue,
      }),
    popup: () => selectPopupMixin(state, popover.popover()),
    setOpen: (open) => popover.setOpen(open),
    trigger: () => selectTriggerMixin(state, popover.trigger()),
    value,
  };
}

/** {@link useSelect} as a render-callback component. */
export function Select<Value = unknown>(props: SelectProps<Value>): FigNode {
  return props.children(useSelect(props));
}
