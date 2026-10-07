import { createMixin, type MixinContext } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { expectHost } from "../internal/diagnostics.ts";
import { bindPart, triggerProps } from "../internal/parts.ts";
import { createPartReference } from "../internal/part-reference.ts";
import type { DialogRegistry } from "./registry.ts";

/** Widget-level state every part reads. Built once per root render. */
export interface DialogPartState {
  readonly closeOnBackdrop: boolean;
  readonly closeOnEscape: boolean;
  readonly descriptionId: string;
  readonly open: boolean;
  readonly registry: DialogRegistry;
  readonly requestOpen: (
    open: boolean,
    event: Event,
    trigger: Element | undefined,
  ) => boolean;
  readonly titleId: string;
}

export const dialogTriggerMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: DialogPartState) => {
    expectHost(context, "dialog trigger", "button");
    return {
      ...triggerProps(context, { disabled: false }),
      "aria-haspopup": "dialog",
      "data-open": state.open ? "" : undefined,
      mix: on("click", (event) => {
        if (event.defaultPrevented) return;
        const trigger = event.currentTarget;
        state.requestOpen(
          true,
          event,
          trigger instanceof Element ? trigger : undefined,
        );
      }),
    };
  },
);

export const dialogMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: DialogPartState) => {
    expectHost(context, "dialog", "dialog");
    const title = createPartReference(
      context,
      "aria-labelledby",
      state.titleId,
    );
    const description = createPartReference(
      context,
      "aria-describedby",
      state.descriptionId,
    );
    return {
      ...title.props,
      ...description.props,
      bind: bindPart(context, state.registry, (node, signal) =>
        state.registry.bindDialog(node, signal, { title, description }),
      ),
      "data-open": state.open ? "" : undefined,
      mix: [
        // Escape reaches the element as a cancelable `cancel`, so a handler that
        // cancels the change keeps the dialog open.
        on("cancel", (event) => {
          if (event.defaultPrevented) return;
          if (!state.closeOnEscape) {
            event.preventDefault();
            return;
          }
          if (!state.requestOpen(false, event, undefined))
            event.preventDefault();
        }),
        // A native close can also come from a form submitted with method
        // "dialog", so state follows the element rather than the other way.
        on("close", (event) => {
          state.requestOpen(false, event, undefined);
        }),
        on(
          "pointerdown",
          (event) => {
            const node = event.currentTarget;
            state.registry.noteBackdropPress(
              node instanceof HTMLElement &&
                event.target === node &&
                isOutsideBox(node, event),
            );
          },
          { capture: true },
        ),
        on("pointercancel", () => state.registry.noteBackdropPress(undefined)),
        on("click", (event) => {
          const beganOutside = state.registry.takeBackdropPress();
          if (event.defaultPrevented || beganOutside === false) return;
          const node = event.currentTarget;
          if (!state.closeOnBackdrop || !(node instanceof HTMLElement)) return;
          if (event.target !== node || !isOutsideBox(node, event)) return;
          state.requestOpen(false, event, node);
        }),
      ],
    };
  },
);

export const dialogTitleMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: DialogPartState) => ({
    bind: bindPart(context, state.registry, (node, signal) =>
      state.registry.bindTitle(node, signal),
    ),
    id: context.props.id ?? state.titleId,
  }),
);

export const dialogDescriptionMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: DialogPartState) => ({
    bind: bindPart(context, state.registry, (node, signal) =>
      state.registry.bindDescription(node, signal),
    ),
    id: context.props.id ?? state.descriptionId,
  }),
);

export const dialogDismissMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: DialogPartState) => {
    expectHost(context, "dialog dismiss control", "button");
    return {
      ...triggerProps(context, { disabled: false }),
      mix: on("click", (event) => {
        if (event.defaultPrevented) return;
        const trigger = event.currentTarget;
        state.requestOpen(
          false,
          event,
          trigger instanceof Element ? trigger : undefined,
        );
      }),
    };
  },
);

/**
 * A click on the backdrop targets the dialog itself, and so does a click on
 * the dialog's own padding. Only the first is a dismissal.
 */
function isOutsideBox(node: HTMLElement, event: MouseEvent): boolean {
  const rect = node.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}
