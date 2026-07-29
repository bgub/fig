import {
  type FigNode,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import {
  createComposite,
  type Orientation,
  sameValue,
} from "../internal/composite.ts";
import { usePartIds } from "../internal/ids.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import { createRelations } from "../internal/relations.ts";
import {
  accordionMixin,
  accordionPanelMixin,
  accordionTriggerMixin,
} from "./parts.ts";

export type AccordionOrientation = Orientation;

export type AccordionValueChangeDetails = ChangeDetails;

export type AccordionValueChangeHandler<Value = unknown> = (
  values: readonly Value[],
  details: AccordionValueChangeDetails,
  signal: AbortSignal,
) => void;

export interface AccordionTriggerOptions {
  disabled?: boolean;
}

export interface AccordionOptions<Value = unknown> {
  /** Allows closing the last open panel in single mode. Defaults to `true`. */
  collapsible?: boolean;
  defaultValue?: readonly Value[];
  /** Disables every trigger. */
  disabled?: boolean;
  /** Keeps more than one panel open at a time. */
  multiple?: boolean;
  onValueChange?: AccordionValueChangeHandler<Value>;
  orientation?: AccordionOrientation;
  value?: readonly Value[];
}

export interface AccordionParts<Value = unknown> {
  readonly values: readonly Value[];
  isOpen(value: Value): boolean;
  /** Marks a panel the caller keeps mounted; closed panels hide. */
  panel(value: Value): MixinDescriptor;
  root(): MixinDescriptor;
  trigger(value: Value, options?: AccordionTriggerOptions): MixinDescriptor;
}

export interface AccordionProps<
  Value = unknown,
> extends AccordionOptions<Value> {
  children: (accordion: AccordionParts<Value>) => FigNode;
}

/**
 * Coordinates one accordion: which panels are open, the relationships between
 * headers and regions, and optional arrow movement between headers. Call it in
 * the component that renders the accordion; every element stays the caller's.
 */
export function useAccordion<Value = unknown>(
  options: AccordionOptions<Value> = {},
): AccordionParts<Value> {
  const {
    collapsible = true,
    disabled = false,
    multiple = false,
    orientation = "vertical",
  } = options;
  const controlledValue = options.value;
  const controlled = controlledValue !== undefined;
  const [uncontrolled, setUncontrolled] = useState<{
    readonly value: readonly Value[];
  }>(() => ({ value: options.defaultValue ?? [] }));
  const values = controlledValue ?? uncontrolled.value;
  const registrationChanged = useRegistrationReconcile();
  const registry = useMemo(
    () =>
      createComposite({
        container: "[data-fig-accordion]",
        item: "[data-fig-accordion-trigger]",
        name: "accordion",
        registrationChanged,
      }),
    [],
  );
  const relations = useMemo(
    () => createRelations(registry, registrationChanged),
    [],
  );
  useBeforePaint(() => {
    relations.sync();
  });

  const emitChange = useStableEvent(
    (
      next: readonly unknown[],
      details: AccordionValueChangeDetails,
      signal: AbortSignal,
    ) => {
      options.onValueChange?.(next as readonly Value[], details, signal);
    },
  );

  const toggle = useStableEvent(
    (value: unknown, event: Event, trigger: Element) => {
      const open = values.some((entry) => sameValue(entry, value));
      if (open && !collapsible && !multiple) return;
      const next = open
        ? values.filter((entry) => !sameValue(entry, value))
        : multiple
          ? [...values, value as Value]
          : [value as Value];
      const details = createChangeDetails(event, trigger);
      emitChange(next, details);
      if (details.isCanceled || controlled) return;
      setUncontrolled({ value: next });
    },
  );

  const idFor = usePartIds();
  const state = { disabled, orientation, registry, relations, toggle };

  function isOpen(value: Value): boolean {
    return values.some((entry) => sameValue(entry, value));
  }

  function panel(panelValue: Value): MixinDescriptor {
    return accordionPanelMixin(state, {
      open: isOpen(panelValue),
      panelId: idFor(panelValue, "panel"),
      triggerId: idFor(panelValue, "trigger"),
      value: panelValue,
    });
  }

  return {
    isOpen,
    panel,
    root: () => accordionMixin(state),
    trigger: (triggerValue, triggerOptions = {}) =>
      accordionTriggerMixin(state, {
        disabled: disabled || triggerOptions.disabled === true,
        open: isOpen(triggerValue),
        panelId: idFor(triggerValue, "panel"),
        triggerId: idFor(triggerValue, "trigger"),
        value: triggerValue,
      }),
    values,
  };
}

/**
 * {@link useAccordion} as a component, for an accordion that is not already a
 * component of its own. Toggling re-renders this root rather than the caller.
 */
export function Accordion<Value = unknown>(
  props: AccordionProps<Value>,
): FigNode {
  return props.children(useAccordion(props));
}
