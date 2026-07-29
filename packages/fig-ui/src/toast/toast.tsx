import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import {
  type ChangeDetails,
  createChangeDetails,
} from "../internal/changes.ts";
import { expectHost } from "../internal/diagnostics.ts";
import { bindPart, triggerProps } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import { createToastRegistry, type ToastRegistration } from "./registry.ts";

export type ToastPriority = "assertive" | "polite";
export type ToastDismissReason = "dismiss" | "timeout";

export interface ToastDismissDetails extends ChangeDetails {
  readonly reason: ToastDismissReason;
}

export type ToastDismissHandler<Value = unknown> = (
  value: Value,
  details: ToastDismissDetails,
  signal: AbortSignal,
) => void;

export interface ToastOptions {
  /** Automatic dismissal delay. `null` keeps the toast. Defaults to 5000ms. */
  duration?: number | null;
}

export interface ToastRegionOptions<Value = unknown> {
  /** Accessible name for the collection. Defaults to `Notifications`. */
  label?: string;
  onDismiss: ToastDismissHandler<Value>;
  /** Announcement urgency for this region. Defaults to `polite`. */
  priority?: ToastPriority;
}

export interface ToastRegionParts<Value = unknown> {
  dismiss(value: Value): MixinDescriptor;
  region(): MixinDescriptor;
  toast(value: Value, options?: ToastOptions): MixinDescriptor;
}

export interface ToastRegionProps<
  Value = unknown,
> extends ToastRegionOptions<Value> {
  children: (region: ToastRegionParts<Value>) => FigNode;
}

type ToastRegistry = ReturnType<typeof createToastRegistry>;

interface ToastRegionState {
  readonly dismiss: (
    value: unknown,
    reason: ToastDismissReason,
    event: Event | null,
    trigger: Element,
  ) => void;
  readonly label: string;
  readonly priority: ToastPriority;
  readonly registry: ToastRegistry;
}

interface ToastState {
  readonly duration: number | null;
  readonly value: unknown;
}

const toastRegionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToastRegionState) => ({
    "aria-atomic": "false",
    "aria-label": context.props["aria-label"] ?? state.label,
    "aria-live": state.priority,
    "aria-relevant": "additions text",
    bind: bindPart(context, state.registry.bindRegion),
    "data-priority": state.priority,
    mix: [
      on("focusin", () => state.registry.setPaused("focus", true)),
      on("focusout", (event) => {
        const region = event.currentTarget;
        const next = event.relatedTarget;
        if (
          region instanceof Element &&
          next instanceof Node &&
          region.contains(next)
        ) {
          return;
        }
        state.registry.setPaused("focus", false);
      }),
      on("pointerenter", () => state.registry.setPaused("pointer", true)),
      on("pointerleave", () => state.registry.setPaused("pointer", false)),
    ],
    role: "region",
  }),
);

const toastMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToastRegionState, own: ToastState) => ({
    "aria-atomic": "true",
    bind: bindPart(context, (node, signal) =>
      state.registry.bindToast(node, signal, {
        duration: own.duration,
        value: own.value,
      }),
    ),
  }),
);

const toastDismissMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: ToastRegionState, value: unknown) => {
    expectHost(context, "toast dismiss control", "button");
    return {
      ...triggerProps(context, { disabled: false }),
      mix: on("click", (event) => {
        if (event.currentTarget instanceof Element) {
          state.dismiss(value, "dismiss", event, event.currentTarget);
        }
      }),
    };
  },
);

/** Coordinates announcements and pauseable lifetimes for caller-owned toasts. */
export function useToastRegion<Value = unknown>(
  options: ToastRegionOptions<Value>,
): ToastRegionParts<Value> {
  const requestReconcile = useRegistrationReconcile();
  const emitDismiss = useStableEvent(
    (value: unknown, details: ToastDismissDetails, signal: AbortSignal) => {
      options.onDismiss(value as Value, details, signal);
    },
  );
  const dismiss = useStableEvent(
    (
      value: unknown,
      reason: ToastDismissReason,
      event: Event | null,
      trigger: Element,
    ) => {
      const details: ToastDismissDetails = {
        ...createChangeDetails(event, trigger),
        reason,
      };
      emitDismiss(value, details);
    },
  );
  const registry = useMemo(
    () =>
      createToastRegistry(requestReconcile, (toast: ToastRegistration) => {
        dismiss(toast.value, "timeout", null, toast.node);
      }),
    [],
  );

  useBeforePaint(() => {
    registry.validate();
  });

  const state: ToastRegionState = {
    dismiss,
    label: options.label ?? "Notifications",
    priority: options.priority ?? "polite",
    registry,
  };

  return {
    dismiss: (value) => toastDismissMixin(state, value),
    region: () => toastRegionMixin(state),
    toast: (value, toastOptions = {}) =>
      toastMixin(state, {
        duration:
          toastOptions.duration === null
            ? null
            : Math.max(0, toastOptions.duration ?? 5000),
        value,
      }),
  };
}

/** {@link useToastRegion} as a render-callback component. */
export function ToastRegion<Value = unknown>(
  props: ToastRegionProps<Value>,
): FigNode {
  return props.children(useToastRegion(props));
}
