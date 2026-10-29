import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
  useStableEvent,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { createAnchoredPopup } from "../internal/anchored-popup.ts";
import { createHoverIntent } from "../internal/hover.ts";
import { expectPopupId } from "../internal/diagnostics.ts";
import type {
  OpenChangeDetails,
  OpenChangeHandler,
} from "../internal/open-state.ts";
import { usePopupState } from "../internal/popup-state.ts";
import { bindPart } from "../internal/parts.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export type TooltipOpenChangeDetails = OpenChangeDetails;
export type TooltipOpenChangeHandler = OpenChangeHandler;

export interface TooltipOptions {
  /** Delay before pointer intent opens the tooltip. Defaults to 500ms. */
  delay?: number;
  /** Delay before pointer exit closes the tooltip. Defaults to 0ms. */
  closeDelay?: number;
  defaultOpen?: boolean;
  disabled?: boolean;
  id?: string;
  onOpenChange?: TooltipOpenChangeHandler;
  open?: boolean;
}

export interface TooltipParts {
  readonly open: boolean;
  setOpen(open: boolean): void;
  tooltip(): MixinDescriptor;
  trigger(): MixinDescriptor;
}

export interface TooltipProps extends TooltipOptions {
  children: (tooltip: TooltipParts) => FigNode;
}

interface TooltipState {
  readonly bindPopup: (node: HTMLElement, signal: AbortSignal) => void;
  readonly bindTrigger: (node: HTMLElement, signal: AbortSignal) => void;
  readonly disabled: boolean;
  readonly nativeToggle: (event: Event) => void;
  readonly open: boolean;
  readonly requestOpen: (
    open: boolean,
    event: Event,
    trigger: Element | undefined,
  ) => boolean;
  readonly schedule: (
    open: boolean | undefined,
    event: Event,
    trigger: Element,
    delay: number,
  ) => void;
  readonly tooltipId: string;
}

const tooltipTriggerMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TooltipState) => ({
    "aria-describedby": references(
      context.props["aria-describedby"],
      state.tooltipId,
    ),
    bind: bindPart(context, state.bindTrigger, state.bindTrigger),
    "data-open": state.open ? "" : undefined,
    mix: [
      on("focusin", (event) => {
        if (!state.disabled && event.currentTarget instanceof Element) {
          state.schedule(true, event, event.currentTarget, 0);
        }
      }),
      on("focusout", (event) => {
        if (event.currentTarget instanceof Element) {
          state.schedule(false, event, event.currentTarget, 0);
        }
      }),
      on("pointerenter", (event) => {
        if (
          !state.disabled &&
          event.pointerType === "mouse" &&
          event.currentTarget instanceof Element
        ) {
          state.schedule(true, event, event.currentTarget, -1);
        }
      }),
      on("pointerleave", (event) => {
        if (
          event.pointerType === "mouse" &&
          event.currentTarget instanceof Element
        ) {
          state.schedule(false, event, event.currentTarget, -1);
        }
      }),
      on("keydown", (event) => {
        if (
          event.defaultPrevented ||
          event.key !== "Escape" ||
          !(event.currentTarget instanceof Element)
        ) {
          return;
        }
        state.schedule(undefined, event, event.currentTarget, 0);
        state.requestOpen(false, event, event.currentTarget);
      }),
    ],
  }),
);

const tooltipMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TooltipState) => {
    expectPopupId(context, state.tooltipId, "tooltip");
    return {
      bind: bindPart(context, state.bindTrigger, state.bindPopup),
      "data-open": state.open ? "" : undefined,
      id: state.tooltipId,
      mix: [
        on("beforetoggle", (event) => {
          state.nativeToggle(event);
        }),
        on("toggle", (event) => {
          state.nativeToggle(event);
        }),
        on("pointerenter", (event) => {
          if (
            event.pointerType === "mouse" &&
            event.currentTarget instanceof Element
          ) {
            state.schedule(undefined, event, event.currentTarget, 0);
          }
        }),
        on("pointerleave", (event) => {
          if (
            event.pointerType === "mouse" &&
            event.currentTarget instanceof Element
          ) {
            state.schedule(false, event, event.currentTarget, -1);
          }
        }),
      ],
      popover: context.props.popover ?? "auto",
      role: "tooltip",
    };
  },
);

/** Coordinates one non-interactive tooltip over caller-owned hosts. */
export function useTooltip(options: TooltipOptions = {}): TooltipParts {
  const { closeDelay = 0, delay = 500, disabled = false } = options;
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () => createAnchoredPopup(requestReconcile, "tooltip"),
    [],
  );
  const { getOpen, open, requestOpen, setOpen, nativeToggle } = usePopupState({
    ...options,
    requestReconcile,
  });
  const id = useId();
  const tooltipId = options.id ?? `${id}-tooltip`;
  const anchorName = `--fig-tooltip-${id.replaceAll(/[^\w-]/g, "-")}`;
  const intent = useMemo(createHoverIntent, []);

  const schedule = useStableEvent(
    (
      next: boolean | undefined,
      event: Event,
      trigger: Element,
      requestedDelay: number,
      signal: AbortSignal,
    ) => {
      intent.cancel();
      if (next === undefined || (next && disabled)) return;
      const wait =
        requestedDelay === -1 ? (next ? delay : closeDelay) : requestedDelay;
      const anchor = registry.anchor();
      intent.schedule(
        next,
        () => {
          // Same-host rebinding preserves intent; replacement invalidates it.
          if (!next || registry.anchor() === anchor)
            requestOpen(next, event, trigger);
        },
        wait,
        signal,
      );
    },
  );

  useBeforePaint(() => {
    if (disabled) intent.cancelOpening();
    registry.sync(getOpen(), anchorName);
  });

  const state: TooltipState = {
    bindPopup: registry.bindPopup,
    bindTrigger: registry.bindAnchor,
    disabled,
    open,
    requestOpen,
    nativeToggle,
    schedule: (next, event, trigger, wait) => {
      const anchor = registry.anchor();
      // Ignore hover before invoking the stable event, which aborts any
      // pending focus timer even when its callback returns immediately.
      if (
        (event.type === "pointerenter" || event.type === "pointerleave") &&
        anchor?.contains(anchor.ownerDocument.activeElement)
      )
        return;
      schedule(next, event, trigger, wait);
    },
    tooltipId,
  };

  return {
    open,
    setOpen,
    tooltip: () => tooltipMixin(state),
    trigger: () => tooltipTriggerMixin(state),
  };
}

/** {@link useTooltip} as a render-callback component. */
export function Tooltip(props: TooltipProps): FigNode {
  return props.children(useTooltip(props));
}

function references(authored: string | undefined, generated: string): string {
  return [...new Set([...(authored?.split(/\s+/) ?? []), generated])]
    .filter(Boolean)
    .join(" ");
}
