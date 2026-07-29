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
  createComposite,
  type Orientation,
  sameValue,
} from "../internal/composite.ts";
import { bindPart } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export type ToolbarOrientation = Orientation;

export interface ToolbarItemOptions {
  disabled?: boolean;
}

export interface ToolbarOptions {
  /** Wraps arrow movement at both ends. Defaults to `true`. */
  loopFocus?: boolean;
  orientation?: ToolbarOrientation;
}

export interface ToolbarParts<Value = unknown> {
  item(value: Value, options?: ToolbarItemOptions): MixinDescriptor;
  root(): MixinDescriptor;
}

export interface ToolbarProps<Value = unknown> extends ToolbarOptions {
  children: (toolbar: ToolbarParts<Value>) => FigNode;
}

type ToolbarRegistry = ReturnType<typeof createComposite>;

interface ToolbarState {
  readonly highlighted: unknown;
  readonly loopFocus: boolean;
  readonly orientation: Orientation;
  readonly registry: ToolbarRegistry;
  readonly setHighlighted: (value: unknown) => void;
}

interface ToolbarItemState {
  readonly disabled: boolean;
  readonly value: unknown;
}

const toolbarRootMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToolbarState) => ({
    "aria-orientation": state.orientation,
    bind: bindPart(context, state.registry.bindContainer),
    "data-orientation": state.orientation,
    mix: [
      on("click", (event) => {
        if (state.registry.itemAt(event.target)?.disabled === true) {
          event.preventDefault();
        }
      }),
      on("focusin", (event) => {
        const item = state.registry.itemAt(event.target);
        if (item !== undefined && !item.disabled) {
          state.setHighlighted(item.value);
        }
      }),
      on("keydown", (event) => {
        if (state.registry.itemAt(event.target) === undefined) return;
        const moved = state.registry.moveFocus(event, {
          loop: state.loopFocus,
          orientation: state.orientation,
          skipDisabled: true,
        });
        if (moved !== undefined) state.setHighlighted(moved.value);
      }),
    ],
    role: "toolbar",
  }),
);

const toolbarItemMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToolbarState, own: ToolbarItemState) => {
    const disabled = own.disabled || context.props.disabled === true;
    return {
      "aria-disabled": disabled ? "true" : undefined,
      bind: bindPart(context, (node, signal) =>
        state.registry.bindItem(node, signal, own.value, disabled),
      ),
      "data-disabled": disabled ? "" : undefined,
      "data-fig-toolbar-item": "",
      disabled:
        context.type === "button" && disabled ? true : context.props.disabled,
      tabindex:
        state.highlighted === null
          ? disabled
            ? -1
            : context.props.tabindex
          : sameValue(state.highlighted, own.value)
            ? 0
            : -1,
      type:
        context.type === "button"
          ? (context.props.type ?? "button")
          : undefined,
    };
  },
);

/** Coordinates one roving tab stop and arrow movement across a toolbar. */
export function useToolbar<Value = unknown>(
  options: ToolbarOptions = {},
): ToolbarParts<Value> {
  const { loopFocus = true, orientation = "horizontal" } = options;
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () =>
      createComposite({
        container: '[role="toolbar"]',
        item: "[data-fig-toolbar-item]",
        name: "toolbar",
        registrationChanged: requestReconcile,
      }),
    [],
  );
  const [highlighted, setHighlightedState] = useState<{
    readonly value: unknown;
  }>(() => ({ value: null }));
  const setHighlighted = useStableEvent((next: unknown) => {
    if (!sameValue(highlighted.value, next)) {
      setHighlightedState({ value: next });
    }
  });

  useBeforePaint(() => {
    const current = registry.item(highlighted.value);
    if (current !== undefined && !current.disabled) return;
    setHighlighted(
      registry.items().find((item) => !item.disabled)?.value ?? null,
    );
  });

  const state: ToolbarState = {
    highlighted: highlighted.value,
    loopFocus,
    orientation,
    registry,
    setHighlighted,
  };

  return {
    item: (value, itemOptions = {}) =>
      toolbarItemMixin(state, {
        disabled: itemOptions.disabled === true,
        value,
      }),
    root: () => toolbarRootMixin(state),
  };
}

/** {@link useToolbar} as a render-callback component. */
export function Toolbar<Value = unknown>(props: ToolbarProps<Value>): FigNode {
  return props.children(useToolbar<Value>(props));
}
