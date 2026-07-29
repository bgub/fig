import type { FigNode, MixinDescriptor } from "@bgub/fig";
import { listMixin, panelMixin, tabMixin } from "./parts.ts";
import { sameValue } from "../internal/composite.ts";
import { usePartIds } from "../internal/ids.ts";
import type { TabsOrientation } from "./registry.ts";
import { type TabsValueChangeHandler, useTabsSelection } from "./selection.ts";

export type { TabsOrientation };
export type {
  TabsValueChangeDetails,
  TabsValueChangeHandler,
} from "./selection.ts";

export interface TabsListOptions {
  /** Selects a tab as soon as it takes focus. */
  activateOnFocus?: boolean;
  /** Wraps arrow-key movement at both ends. Defaults to `true`. */
  loopFocus?: boolean;
}

export interface TabsTabOptions {
  disabled?: boolean;
}

export interface TabsParts<Value = unknown> {
  readonly value: Value | null;
  list(options?: TabsListOptions): MixinDescriptor;
  /** Marks a panel the caller keeps mounted; inactive panels hide. */
  panel(value: Value): MixinDescriptor;
  tab(value: Value, options?: TabsTabOptions): MixinDescriptor;
}

export interface TabsOptions<Value = unknown> {
  defaultValue?: Value | null;
  onValueChange?: TabsValueChangeHandler<Value>;
  orientation?: TabsOrientation;
  value?: Value | null;
}

export interface TabsProps<Value = unknown> extends TabsOptions<Value> {
  children: (tabs: TabsParts<Value>) => FigNode;
}

/**
 * Coordinates one tabs widget: selection, focus, and the generated
 * relationships between parts. Call it in the component that renders the
 * widget; every element stays the caller's.
 */
export function useTabs<Value = unknown>(
  options: TabsOptions<Value> = {},
): TabsParts<Value> {
  const props = options;
  const { orientation = "horizontal" } = props;
  const controlledValue = props.value;
  const controlled = controlledValue !== undefined;
  const implicitDefault = !controlled && props.defaultValue === undefined;
  const selection = useTabsSelection<Value>({
    controlled,
    implicitDefault,
    onValueChange: props.onValueChange,
    value:
      controlledValue === undefined
        ? (props.defaultValue ?? null)
        : controlledValue,
  });
  const { value } = selection;
  const idFor = usePartIds();
  const state = {
    orientation,
    registry: selection.registry,
    resetHighlight: selection.resetHighlight,
    select: selection.select,
    setHighlighted: selection.setHighlighted,
  };
  function isSelected(partValue: unknown): boolean {
    return value !== null && sameValue(partValue, value);
  }

  function panel(panelValue: Value): MixinDescriptor {
    return panelMixin(state, {
      active: isSelected(panelValue),
      panelId: idFor(panelValue, "panel"),
      tabId: idFor(panelValue, "tab"),
      value: panelValue,
    });
  }

  return {
    value,
    list: (options = {}) =>
      listMixin(state, {
        activateOnFocus: options.activateOnFocus === true,
        loopFocus: options.loopFocus !== false,
      }),
    panel,
    tab: (tabValue, options = {}) =>
      tabMixin(state, {
        disabled: options.disabled === true,
        highlighted: sameValue(selection.highlightedValue, tabValue),
        panelId: idFor(tabValue, "panel"),
        selected: isSelected(tabValue),
        tabId: idFor(tabValue, "tab"),
        value: tabValue,
      }),
  };
}

/**
 * {@link useTabs} as a component, for a widget that is not already one of its
 * own. Selection re-renders this root rather than the caller.
 */
export function Tabs<Value = unknown>(props: TabsProps<Value>): FigNode {
  return props.children(useTabs(props));
}
