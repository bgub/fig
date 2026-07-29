import {
  createMixin,
  type FigNode,
  type MixinContext,
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
import { sameValue } from "../internal/composite.ts";
import {
  assertAccessibleName,
  assertSingleSelection,
} from "../internal/diagnostics.ts";
import { usePartIds } from "../internal/ids.ts";
import {
  createListbox as createListboxRegistry,
  type ListboxOption,
} from "../internal/listbox.ts";
import { bindPart, setIdReference } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export type ListboxValueChangeDetails = ChangeDetails;

export type ListboxValueChangeHandler<Value = unknown> = (
  values: readonly Value[],
  details: ListboxValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface ListboxOptionOptions {
  disabled?: boolean;
  /** Text used for typeahead when it differs from the host's text content. */
  textValue?: string;
}

export interface ListboxOptions<Value = unknown> {
  defaultValue?: readonly Value[];
  disabled?: boolean;
  multiple?: boolean;
  onValueChange?: ListboxValueChangeHandler<Value>;
  readOnly?: boolean;
  value?: readonly Value[];
}

export interface ListboxParts<Value = unknown> {
  readonly values: readonly Value[];
  option(value: Value, options?: ListboxOptionOptions): MixinDescriptor;
  root(): MixinDescriptor;
}

export interface ListboxProps<Value = unknown> extends ListboxOptions<Value> {
  children: (listbox: ListboxParts<Value>) => FigNode;
}

type ListboxRegistry = ReturnType<typeof createListboxRegistry>;

interface ListboxState {
  readonly disabled: boolean;
  readonly highlighted: unknown;
  readonly idFor: (value: unknown, part: string) => string;
  readonly multiple: boolean;
  readonly readOnly: boolean;
  readonly registry: ListboxRegistry;
  readonly select: (option: ListboxOption, event: Event) => void;
  readonly setHighlighted: (value: unknown) => void;
}

interface ListboxOptionState {
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly textValue: string | undefined;
  readonly value: unknown;
}

const listboxRootMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ListboxState) => ({
    "aria-activedescendant":
      state.highlighted === null
        ? undefined
        : (state.registry.option(state.highlighted)?.node.id ??
          state.idFor(state.highlighted, "option")),
    "aria-disabled": state.disabled ? "true" : undefined,
    "aria-multiselectable": state.multiple ? "true" : undefined,
    "aria-readonly": state.readOnly ? "true" : undefined,
    bind: bindPart(context, state.registry.bindContainer),
    "data-disabled": state.disabled ? "" : undefined,
    "data-readonly": state.readOnly ? "" : undefined,
    mix: [
      on("click", (event) => {
        const option = state.registry.optionAt(event.target);
        if (option === undefined) return;
        if (state.disabled || option.disabled) {
          event.preventDefault();
        } else if (event.button === 0) {
          state.setHighlighted(option.value);
          if (state.readOnly) event.preventDefault();
          else state.select(option, event);
        }
      }),
      on("pointerdown", (event) => {
        if (state.registry.optionAt(event.target) === undefined) return;
        event.preventDefault();
        if (!state.disabled && event.currentTarget instanceof HTMLElement) {
          event.currentTarget.focus();
        }
      }),
      on("pointermove", (event) => {
        if (state.disabled) return;
        const option = state.registry.optionAt(event.target);
        if (option !== undefined && !option.disabled) {
          state.setHighlighted(option.value);
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
        const moved = state.registry.move(state.highlighted, event.key);
        if (moved !== undefined) {
          event.preventDefault();
          state.setHighlighted(moved.value);
          if (!state.multiple) state.select(moved, event);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          const option = state.registry.option(state.highlighted);
          if (option !== undefined) {
            event.preventDefault();
            state.select(option, event);
          }
          return;
        }
        const match = state.registry.typeahead(state.highlighted, event.key);
        if (match === undefined) return;
        state.setHighlighted(match.value);
        if (!state.multiple) state.select(match, event);
      }),
    ],
    role: "listbox",
    tabindex: state.disabled ? -1 : (context.props.tabindex ?? 0),
  }),
);

const listboxOptionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ListboxState, own: ListboxOptionState) => {
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
      tabindex: -1,
    };
  },
);

/** Coordinates selection and active-descendant navigation for one listbox. */
export function useListbox<Value = unknown>(
  options: ListboxOptions<Value> = {},
): ListboxParts<Value> {
  const { disabled = false, multiple = false, readOnly = false } = options;
  const controlled = options.value !== undefined;
  const initialValue = useMemo(() => options.defaultValue ?? [], []);
  const [uncontrolled, setUncontrolled] =
    useState<readonly Value[]>(initialValue);
  const values = controlled ? (options.value ?? []) : uncontrolled;
  if (!multiple) assertSingleSelection(values, "single-select listbox");

  const [highlighted, setHighlightedState] = useState<{
    readonly value: unknown;
  }>(() => ({ value: values[0] ?? null }));
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () => createListboxRegistry("listbox", requestReconcile),
    [],
  );
  const idFor = usePartIds();
  const tracker = useMemo(() => ({ values }), []);
  tracker.values = values;

  const emitChange = useStableEvent(
    (
      next: readonly Value[],
      details: ListboxValueChangeDetails,
      signal: AbortSignal,
    ) => {
      options.onValueChange?.(next, details, signal);
    },
  );
  const change = useStableEvent(
    (next: readonly Value[], event: Event, trigger: Element) => {
      if (sameValues(next, tracker.values)) return;
      const details = createChangeDetails(event, trigger);
      emitChange(next, details);
      if (details.isCanceled) {
        if (controlled) requestReconcile();
        return;
      }
      tracker.values = next;
      if (controlled) requestReconcile();
      else setUncontrolled(next);
    },
  );
  const select = useStableEvent((option: ListboxOption, event: Event) => {
    if (disabled || readOnly || option.disabled) return;
    const selected = tracker.values.some((value) =>
      sameValue(value, option.value),
    );
    const next = multiple
      ? selected
        ? tracker.values.filter((value) => !sameValue(value, option.value))
        : [...tracker.values, option.value as Value]
      : [option.value as Value];
    change(next, event, option.node);
  });
  const setHighlighted = useStableEvent((next: unknown) => {
    if (!sameValue(highlighted.value, next)) {
      setHighlightedState({ value: next });
    }
  });

  useBeforePaint(() => {
    const mounted = registry.options();
    const nextHighlight =
      registry.option(highlighted.value)?.disabled === false
        ? highlighted.value
        : (values.find((value) => registry.option(value)?.disabled === false) ??
          mounted.find((option) => !option.disabled)?.value ??
          null);
    setHighlighted(nextHighlight);

    const root = registry.containerNode();
    if (root !== null) {
      assertAccessibleName(root, "listbox");
      const optionId =
        nextHighlight === null
          ? undefined
          : (registry.option(nextHighlight)?.node.id ??
            idFor(nextHighlight, "option"));
      setIdReference(root, "aria-activedescendant", optionId);
    }
  });

  const state: ListboxState = {
    disabled,
    highlighted: highlighted.value,
    idFor,
    multiple,
    readOnly,
    registry,
    select,
    setHighlighted,
  };

  return {
    option: (value, optionOptions = {}) =>
      listboxOptionMixin(state, {
        disabled: optionOptions.disabled === true,
        selected: values.some((selected) => sameValue(selected, value)),
        textValue: optionOptions.textValue,
        value,
      }),
    root: () => listboxRootMixin(state),
    values,
  };
}

/** {@link useListbox} as a render-callback component. */
export function Listbox<Value = unknown>(props: ListboxProps<Value>): FigNode {
  return props.children(useListbox(props));
}

function sameValues(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => sameValue(value, right[index]))
  );
}
