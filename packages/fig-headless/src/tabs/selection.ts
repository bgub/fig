import { useBeforePaint, useMemo, useStableEvent, useState } from "@bgub/fig";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import {
  type CompositeItem,
  isNativeEnabled,
  sameValue,
} from "../internal/composite.ts";
import { useControllableValue } from "../internal/controllable-value.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import { createTabsRegistry } from "./registry.ts";

export type TabsValueChangeDetails = ChangeDetails;

export type TabsValueChangeHandler<Value = unknown> = (
  value: Value | null,
  details: TabsValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface TabsSelectionOptions<Value> {
  readonly controlled: boolean;
  /**
   * Neither `value` nor `defaultValue`, so the root selects the first enabled
   * tab itself. An explicit `defaultValue` of `null` means the opposite: the
   * application asked for no selection.
   */
  readonly implicitDefault: boolean;
  readonly onValueChange: TabsValueChangeHandler<Value> | undefined;
  /** The controlled value, or the initial value of an uncontrolled root. */
  readonly value: Value | null;
}

interface SelectionTracker {
  /** An explicitly requested default stays selected even while disabled. */
  exempt: unknown;
  value: unknown;
}

const none = Symbol("fig-headless.tabs.none");

/**
 * Owns tab selection: user activation, the roving tab stop, and the automatic
 * repairs an uncontrolled root makes when its tabs change.
 */
export function useTabsSelection<Value>(options: TabsSelectionOptions<Value>) {
  const { controlled } = options;
  const registrationChanged = useRegistrationReconcile();
  const selection = useControllableValue<Value | null>({
    value: controlled ? options.value : undefined,
    defaultValue: options.value,
    onChange: options.onValueChange,
    equal: sameValue,
    reconcile: registrationChanged,
  });
  const { value } = selection;
  const [highlighted, setHighlightedState] = useState<unknown>(() =>
    options.value === null ? none : options.value,
  );
  const tracker = useMemo<SelectionTracker>(
    () => ({
      exempt: controlled || options.implicitDefault ? none : options.value,
      value,
    }),
    [],
  );
  const autoSelect = !controlled && options.implicitDefault;
  const registry = useMemo(() => createTabsRegistry(registrationChanged), []);

  const setHighlighted = useStableEvent((highlighted: unknown) => {
    setHighlightedState(() => highlighted);
  });

  const select = useStableEvent(
    (next: unknown, event: Event, trigger: Element) => {
      if (
        selection.request(
          () => next as Value | null,
          createChangeDetails(event, trigger),
        ) &&
        !controlled
      ) {
        setHighlighted(next);
      }
    },
  );

  const resetHighlight = useStableEvent(() => {
    const tabs = registry.items().filter(isNativeEnabled);
    const selected =
      value === null
        ? undefined
        : tabs.find((tab) => sameValue(tab.value, value));
    const next = selected ?? tabs[0];
    if (next !== undefined) setHighlighted(next.value);
  });

  useBeforePaint(() => {
    registry.sync();
    const tabs = registry.items();
    const focusable = tabs.filter(isNativeEnabled);
    const previous = tracker.value;
    const changed = !sameValue(previous, value);

    const repair = controlled
      ? null
      : planRepair(tabs, value, autoSelect, tracker);
    if (repair !== null) {
      // A repair committed in an earlier pass may not have rendered yet.
      if (sameValue(repair.value, previous)) return;
      const target =
        focusable.find((tab) => sameValue(tab.value, repair.value)) ??
        focusable[0];
      tracker.value = repair.value;
      if (target !== undefined) setHighlighted(target.value);
      selection.restore(
        repair.value as Value | null,
        createChangeDetails(null),
      );
      return;
    }
    tracker.value = value;

    const next = nextHighlight(
      focusable,
      value,
      highlighted,
      changed && !registry.containsFocus(),
    );
    if (!sameValue(next, highlighted)) setHighlighted(next);
  });

  return {
    highlightedValue: highlighted,
    registry,
    resetHighlight,
    select,
    setHighlighted,
    value,
  };
}

/**
 * Decides how an uncontrolled root reacts to the tabs it actually has. An
 * automatic change is reported through `onValueChange` with a `null` event,
 * which is what separates it from a user activation.
 */
function planRepair(
  tabs: readonly CompositeItem[],
  value: unknown,
  autoSelect: boolean,
  tracker: SelectionTracker,
): { readonly value: unknown } | null {
  // Every tab is unregistered: the subtree unmounted or an Activity hid it.
  // Either way the selection is worth keeping for when tabs return.
  if (tabs.length === 0) return null;

  const selected =
    value === null
      ? undefined
      : tabs.find((tab) => sameValue(tab.value, value));
  const disabled =
    selected !== undefined && (selected.disabled || !isNativeEnabled(selected));
  const missing = selected === undefined && value !== null;
  // A root that was never told what to select picks the first enabled tab.
  const unselected = value === null && autoSelect;

  if (sameValue(value, tracker.exempt)) {
    if (disabled) return null;
    tracker.exempt = none;
  }
  if (!disabled && !missing && !unselected) return null;

  const enabled = tabs.find((tab) => !tab.disabled && isNativeEnabled(tab));
  // `undefined` is a usable tab value, so never collapse it with `??`.
  const fallback = enabled === undefined ? null : enabled.value;
  return sameValue(value, fallback) ? null : { value: fallback };
}

/**
 * Keeps the roving tab stop on a mounted tab. Selection may claim it, but
 * never while the user is navigating inside the list.
 */
function nextHighlight(
  tabs: readonly CompositeItem[],
  value: unknown,
  highlighted: unknown,
  selectionMayClaim: boolean,
): unknown {
  const current = tabs.find((tab) => sameValue(tab.value, highlighted));
  const selected =
    value === null
      ? undefined
      : tabs.find((tab) => sameValue(tab.value, value));
  if (current === undefined) {
    const fallback = selected ?? tabs[0];
    return fallback === undefined ? highlighted : fallback.value;
  }
  if (selectionMayClaim && selected !== undefined && !selected.disabled) {
    return selected.value;
  }
  return highlighted;
}
