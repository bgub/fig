import {
  createMixin,
  type FigNode,
  type MixinDescriptor,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import {
  type ComboboxInputValueChangeHandler,
  useCombobox,
} from "../combobox/combobox.tsx";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import { assertUniqueValues } from "../internal/diagnostics.ts";

/** Values must be unique and non-null. Keep the items array stable between edits. */
export interface CommandItem<Value = string> {
  readonly value: Value;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly group?: string;
  readonly disabled?: boolean;
}

export interface CommandOptions<Value = string> {
  items: readonly CommandItem<Value>[];
  defaultInputValue?: string;
  disabled?: boolean;
  inputValue?: string;
  /** False preserves caller-supplied ordering/results, for example remote search. */
  filter?: false | ((item: CommandItem<Value>, query: string) => boolean);
  onInputValueChange?: ComboboxInputValueChangeHandler;
  onAction?: (
    item: CommandItem<Value>,
    details: ChangeDetails,
    signal: AbortSignal,
  ) => void;
}

export interface CommandParts<Value = string> {
  readonly inputValue: string;
  /** Matching items in caller order, including disabled matches. */
  readonly items: readonly CommandItem<Value>[];
  readonly empty: boolean;
  input(): MixinDescriptor;
  list(): MixinDescriptor;
  item(item: CommandItem<Value>): MixinDescriptor;
  group(label: string): MixinDescriptor;
  emptyMessage(): MixinDescriptor;
}

export interface CommandProps<Value = string> extends CommandOptions<Value> {
  children: (command: CommandParts<Value>) => FigNode;
}

const groupMixin = /* @__PURE__ */ createMixin(
  (context, label: string, hidden: boolean) => ({
    "aria-label":
      context.props["aria-labelledby"] == null
        ? (context.props["aria-label"] ?? label)
        : undefined,
    hidden: hidden ? true : undefined,
    role: "group",
  }),
);

const emptyMixin = /* @__PURE__ */ createMixin((_context, empty: boolean) => ({
  hidden: empty ? undefined : true,
  role: "status",
}));

/** Searchable actions, composed from an always-visible inline Combobox. */
export function useCommand<Value = string>(
  options: CommandOptions<Value>,
): CommandParts<Value> {
  const emitAction = useStableEvent(
    (item: CommandItem<Value>, details: ChangeDetails, signal: AbortSignal) => {
      options.onAction?.(item, details, signal);
    },
  );
  const combobox = useCombobox<Value>({
    disabled: options.disabled,
    inline: true,
    open: true,
    value: null,
    inputValue: options.inputValue,
    defaultInputValue: options.defaultInputValue,
    onInputValueChange: (next, details, signal) => {
      // Selecting an action never copies its label into the query.
      if (details.isCanceled) return;
      options.onInputValueChange?.(next, details, signal);
    },
    onValueChange: (value, details) => {
      if (value === null) return;
      // Refuse selection before invoking application code, including a callback
      // that throws. Repeated invocations remain actions, never stored values.
      details.cancel();
      const item = visible.get(value);
      if (item === undefined || item.disabled) return;
      emitAction(item, createChangeDetails(details.event, details.trigger));
    },
  });
  const inputValue = combobox.inputValue;
  const indexed = useMemo(() => {
    assertUniqueValues(options.items, "command item");
    return options.filter === undefined
      ? options.items.map((item) => ({
          item,
          text: [item.label, ...(item.keywords ?? [])]
            .join(" ")
            .toLocaleLowerCase(),
        }))
      : [];
  }, [options.items, options.filter]);
  const items = useMemo(() => {
    if (options.filter === false) return options.items;
    if (options.filter !== undefined) {
      const filter = options.filter;
      return options.items.filter((item) => filter(item, inputValue));
    }
    const query = inputValue.trim().toLocaleLowerCase();
    return query === ""
      ? options.items
      : indexed
          .filter(({ text }) => text.includes(query))
          .map(({ item }) => item);
  }, [indexed, options.items, options.filter, inputValue]);
  const groups = useMemo(
    () => new Set(items.map((item) => item.group)),
    [items],
  );
  const visible = useMemo(
    () => new Map(items.map((item) => [item.value, item])),
    [items],
  );

  return {
    inputValue,
    items,
    empty: items.length === 0,
    input: () => combobox.input(),
    list: () => combobox.popup(),
    item: (item) =>
      combobox.option(item.value, {
        disabled: item.disabled,
        textValue: item.label,
      }),
    group: (label) => groupMixin(label, !groups.has(label)),
    emptyMessage: () => emptyMixin(items.length === 0),
  };
}

/** {@link useCommand} as a render-callback component. */
export function Command<Value = string>(props: CommandProps<Value>): FigNode {
  return props.children(useCommand(props));
}
