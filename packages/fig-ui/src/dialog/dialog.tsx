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
import {
  dialogDescriptionMixin,
  dialogDismissMixin,
  dialogMixin,
  dialogTitleMixin,
  dialogTriggerMixin,
} from "./parts.ts";
import { createDialogRegistry } from "./registry.ts";

export type DialogOpenChangeDetails = OpenChangeDetails;

export type DialogOpenChangeHandler = OpenChangeHandler;

export interface DialogOptions {
  /** Dismiss on a click outside the dialog box. Defaults to `true`. */
  closeOnBackdrop?: boolean;
  /** Dismiss on Escape. Defaults to `true`. */
  closeOnEscape?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: DialogOpenChangeHandler;
  open?: boolean;
}

export interface DialogParts {
  readonly open: boolean;
  /** Describes the dialog for assistive technology. */
  description(): MixinDescriptor;
  /** Applies to the caller's own `<dialog>` element. */
  dialog(): MixinDescriptor;
  /** A control inside the dialog that closes it. */
  dismiss(): MixinDescriptor;
  /** Opens or closes without an activation event. */
  setOpen(open: boolean): void;
  /** Names the dialog for assistive technology. */
  title(): MixinDescriptor;
  trigger(): MixinDescriptor;
}

export interface DialogProps extends DialogOptions {
  children: (dialog: DialogParts) => FigNode;
}

/**
 * Coordinates one modal dialog around the native `<dialog>` element, which
 * owns the top layer, focus containment and restoration, the inert background,
 * and Escape. The widget owns open state, labelling, and dismissal policy.
 */
export function useDialog(options: DialogOptions = {}): DialogParts {
  const { closeOnBackdrop = true, closeOnEscape = true } = options;
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () => createDialogRegistry(requestReconcile, { descriptionId, titleId }),
    [],
  );
  const { open, requestOpen, setOpen } = useOpenState({
    ...options,
    requestReconcile,
  });

  useBeforePaint(() => {
    registry.sync(open);
  });

  const state = {
    closeOnBackdrop,
    closeOnEscape,
    descriptionId,
    open,
    registry,
    requestOpen,
    titleId,
  };

  return {
    description: () => dialogDescriptionMixin(state),
    dialog: () => dialogMixin(state),
    dismiss: () => dialogDismissMixin(state),
    open,
    setOpen,
    title: () => dialogTitleMixin(state),
    trigger: () => dialogTriggerMixin(state),
  };
}

/**
 * {@link useDialog} as a component, for a dialog that is not already a
 * component of its own. Opening re-renders this root rather than the caller.
 */
export function Dialog(props: DialogProps): FigNode {
  return props.children(useDialog(props));
}
