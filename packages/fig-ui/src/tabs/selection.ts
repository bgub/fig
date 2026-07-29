import { useBeforePaint, useMemo, useStableEvent, useState } from "@bgub/fig";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import { type CompositeItem, sameValue } from "../internal/composite.ts";
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

interface SelectionState {
  /** The value holding the roving tab stop. */
  readonly highlighted: unknown;
  readonly value: unknown;
}

interface SelectionTracker {
  /** An explicitly requested default stays selected even while disabled. */
  exempt: unknown;
  value: unknown;
}

const none = Symbol("fig-ui.tabs.none");

/**
 * Owns tab selection: user activation, the roving tab stop, and the automatic
 * repairs an uncontrolled root makes when its tabs change.
 */
export function useTabsSelection<Value>(options: TabsSelectionOptions<Value>) {
  const { controlled } = options;
  const [state, setState] = useState<SelectionState>(() => ({
    highlighted: options.value === null ? none : options.value,
    value: options.value,
  }));
  const value = (controlled ? options.value : state.value) as Value | null;
  const tracker = useMemo<SelectionTracker>(
    () => ({
      exempt: controlled || options.implicitDefault ? none : options.value,
      value,
    }),
    [],
  );
  const autoSelect = !controlled && options.implicitDefault;
  const registrationChanged = useRegistrationReconcile();
  const registry = useMemo(() => createTabsRegistry(registrationChanged), []);

  const setHighlighted = useStableEvent((highlighted: unknown) => {
    setState((current) =>
      sameValue(current.highlighted, highlighted)
        ? current
        : { ...current, highlighted },
    );
  });

  const emitChange = useStableEvent(
    (next: unknown, details: TabsValueChangeDetails, signal: AbortSignal) => {
      options.onValueChange?.(next as Value | null, details, signal);
    },
  );

  const select = useStableEvent(
    (next: unknown, event: Event, trigger: Element) => {
      if (sameValue(next, value)) return;
      const details = createChangeDetails(event, trigger);
      emitChange(next, details);
      if (details.isCanceled || controlled) return;
      setState({ highlighted: next, value: next });
    },
  );

  const resetHighlight = useStableEvent(() => {
    const selected = value === null ? undefined : registry.item(value);
    const next = selected ?? registry.items()[0];
    if (next !== undefined) setHighlighted(next.value);
  });

  useBeforePaint(() => {
    registry.sync();
    const tabs = registry.items();
    const previous = tracker.value;
    const changed = !sameValue(previous, value);

    const repair = controlled
      ? null
      : planRepair(tabs, value, autoSelect, tracker);
    if (repair !== null) {
      // A repair committed in an earlier pass may not have rendered yet.
      if (sameValue(repair.value, previous)) return;
      const target =
        repair.value === null ? tabs[0] : registry.item(repair.value);
      tracker.value = repair.value;
      setState((current) => ({
        highlighted: target === undefined ? current.highlighted : target.value,
        value: repair.value,
      }));
      emitChange(repair.value, createChangeDetails(null));
      return;
    }
    tracker.value = value;

    const highlighted = nextHighlight(
      tabs,
      value,
      state.highlighted,
      changed && !registry.containsFocus(),
    );
    if (!sameValue(highlighted, state.highlighted)) {
      setState((current) => ({ ...current, highlighted }));
    }
  });

  return {
    highlightedValue: state.highlighted,
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
  const disabled = selected?.disabled === true;
  const missing = selected === undefined && value !== null;
  // A root that was never told what to select picks the first enabled tab.
  const unselected = value === null && autoSelect;

  if (sameValue(value, tracker.exempt)) {
    if (disabled) return null;
    tracker.exempt = none;
  }
  if (!disabled && !missing && !unselected) return null;

  const enabled = tabs.find((tab) => !tab.disabled);
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
