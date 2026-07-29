import {
  type FigNode,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
} from "@bgub/fig";
import type {
  OpenChangeDetails,
  OpenChangeHandler,
} from "../internal/open-state.ts";
import { useOpenState } from "../internal/open-state.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";
import { popoverMixin, popoverTriggerMixin } from "./parts.ts";
import { createPopoverRegistry } from "./registry.ts";

export type PopoverOpenChangeDetails = OpenChangeDetails;

export type PopoverOpenChangeHandler = OpenChangeHandler;

export interface PopoverOptions {
  defaultOpen?: boolean;
  /** The popover id emitted on the server and referenced by its trigger. */
  id?: string;
  onOpenChange?: PopoverOpenChangeHandler;
  open?: boolean;
}

export interface PopoverParts {
  readonly open: boolean;
  /** Applies to the caller's own popover element. */
  popover(): MixinDescriptor;
  /** Opens or closes without an activation event. */
  setOpen(open: boolean): void;
  trigger(): MixinDescriptor;
}

export interface PopoverProps extends PopoverOptions {
  children: (popover: PopoverParts) => FigNode;
}

/**
 * Coordinates one popover around the native popover API, which owns the top
 * layer, light dismiss, and Escape, and around CSS anchor positioning, which
 * owns placement. The widget owns open state and the wiring between the two
 * elements, and measures nothing.
 */
export function usePopover(options: PopoverOptions = {}): PopoverParts {
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(() => createPopoverRegistry(requestReconcile), []);
  const { open, requestOpen, setOpen } = useOpenState({
    ...options,
    requestReconcile,
  });

  const id = useId();
  const anchorName = `--fig-popover-${id.replaceAll(/[^\w-]/g, "-")}`;
  const popoverId = options.id ?? `${id}-popover`;

  useBeforePaint(() => {
    registry.sync(open, anchorName);
  });

  const state = { open, popoverId, registry, requestOpen };

  return {
    open,
    popover: () => popoverMixin(state),
    setOpen,
    trigger: () => popoverTriggerMixin(state),
  };
}

/**
 * {@link usePopover} as a component, for a popover that is not already a
 * component of its own. Opening re-renders this root rather than the caller.
 */
export function Popover(props: PopoverProps): FigNode {
  return props.children(usePopover(props));
}
