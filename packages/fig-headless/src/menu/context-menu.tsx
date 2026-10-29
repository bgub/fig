import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useId,
  useMemo,
  useStableEvent,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { createChangeDetails } from "../internal/changes.ts";
import { bindPart } from "../internal/parts.ts";
import { createPartSlot } from "../internal/registration.ts";
import { menuController, registerMenuController } from "./controller.ts";
import { type MenuOptions, type MenuParts, useMenu } from "./menu.tsx";

export interface ContextMenuOptions<
  Value = unknown,
> extends MenuOptions<Value> {
  disabled?: boolean;
}

export interface ContextMenuProps<
  Value = unknown,
> extends ContextMenuOptions<Value> {
  children: (menu: MenuParts<Value>) => FigNode;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TriggerState {
  readonly owner: object;
  readonly bind: (node: HTMLElement, signal: AbortSignal) => void;
  readonly disabled: boolean;
  readonly id: string;
  readonly open: boolean;
  readonly popupId: string;
  readonly show: (event: MouseEvent | KeyboardEvent) => void;
}

const contextTriggerMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, state: TriggerState) => {
    const disabled = state.disabled || context.props.disabled === true;
    return {
      "aria-disabled": disabled ? "true" : undefined,
      "aria-controls": state.popupId,
      "aria-expanded": state.open ? "true" : "false",
      "aria-haspopup": "menu",
      bind: bindPart(context, state.owner, state.bind),
      "data-disabled": disabled ? "" : undefined,
      "data-open": state.open ? "" : undefined,
      id: context.props.id ?? state.id,
      // A context area may be an ordinary div. It must be reachable by the
      // keyboard, and capable of receiving focus back when the menu closes.
      tabindex: context.props.tabindex ?? 0,
      type:
        context.type === "button"
          ? (context.props.type ?? "button")
          : undefined,
      mix: [
        on("contextmenu", (event) => {
          if (disabled || event.defaultPrevented) return;
          state.show(event);
        }),
        on("keydown", (event) => {
          if (
            disabled ||
            event.defaultPrevented ||
            event.isComposing ||
            event.keyCode === 229 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (
            event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey)
          )
            state.show(event);
        }),
      ],
    };
  },
);

/** Optional point-positioned menu; ordinary clicks retain their native action. */
export function useContextMenu<Value = unknown>(
  options: ContextMenuOptions<Value> = {},
): MenuParts<Value> {
  const id = useId();
  const popupId = options.id ?? `${id}-context-menu`;
  const tracker = useMemo(
    () => ({
      trigger: createPartSlot(() => {}),
      activation: null as MouseEvent | KeyboardEvent | null,
      positioner: createContextPositioner(),
    }),
    [],
  );
  const [point, setPoint] = useState<Point | null>(null);
  const menu = useMenu<Value>({
    ...options,
    id: popupId,
    onOpenChange: (open, details, signal) => {
      if (tracker.activation === null) {
        options.onOpenChange?.(open, details, signal);
        return;
      }
      const activation = createChangeDetails(
        tracker.activation,
        tracker.trigger.node() ?? undefined,
      );
      options.onOpenChange?.(open, activation, signal);
      if (activation.isCanceled) details.cancel();
    },
  });
  const controller = menuController(menu);
  const bind = useStableEvent((node: HTMLElement, signal: AbortSignal) => {
    tracker.trigger.bind(node, signal);
    controller.bindTrigger(node, signal);
  });
  const show = useStableEvent((event: MouseEvent | KeyboardEvent) => {
    const trigger = tracker.trigger.node();
    if (trigger === null || trigger.matches(":disabled")) return;
    event.preventDefault();
    if (event instanceof KeyboardEvent) {
      // Recompute from the element on resize/scroll for keyboard invocation.
      setPoint(null);
    } else setPoint({ x: event.clientX, y: event.clientY });
    tracker.activation = event;
    try {
      controller.setOpen(true, "first");
    } finally {
      tracker.activation = null;
    }
  });

  useBeforePaint((signal) => {
    signal.addEventListener("abort", tracker.positioner.stop, { once: true });
  }, []);
  useBeforePaint(() => {
    tracker.positioner.sync(
      menu.open ? controller.popup() : null,
      tracker.trigger.node(),
      point,
    );
  });

  const parts: MenuParts<Value> = {
    ...menu,
    trigger: (): MixinDescriptor =>
      contextTriggerMixin({
        owner: tracker.trigger,
        bind,
        disabled: options.disabled === true,
        id: `${id}-trigger`,
        open: menu.open,
        popupId,
        show,
      }),
  };
  registerMenuController(parts, controller);
  return parts;
}

/** {@link useContextMenu} as a render-callback component. */
export function ContextMenu<Value = unknown>(
  props: ContextMenuProps<Value>,
): FigNode {
  return props.children(useContextMenu(props));
}

/** Retains observation across renders; only changed hosts replace listeners. */
function createContextPositioner() {
  let currentPopup: HTMLElement | null = null;
  let currentTrigger: HTMLElement | null = null;
  let currentPoint: Point | null = null;
  let cleanup: (() => void) | undefined;
  let reposition = () => {};

  function stop() {
    cleanup?.();
    cleanup = undefined;
    currentPopup = null;
    currentTrigger = null;
    reposition = () => {};
  }

  function sync(
    popup: HTMLElement | null,
    trigger: HTMLElement | null,
    point: Point | null,
  ) {
    currentPoint = point;
    if (popup !== currentPopup || trigger !== currentTrigger) {
      stop();
      if (popup !== null && trigger !== null) {
        currentPopup = popup;
        currentTrigger = trigger;
        cleanup = observe(popup, trigger);
      }
    }
    reposition();
  }

  function observe(popup: HTMLElement, trigger: HTMLElement): () => void {
    const view = popup.ownerDocument.defaultView;
    if (view === null) return () => {};
    // Point positioning deliberately replaces CSS anchor placement only for
    // this optional widget. Keep authored inline styles intact on teardown.
    const properties = [
      "position",
      "right",
      "bottom",
      "margin",
      "position-area",
      "left",
      "top",
      "max-width",
      "max-height",
      "box-sizing",
      "overflow",
    ] as const;
    const previous = new Map<string, readonly [string, string]>();
    const applied = new Map<string, string>();
    const restore = () => {
      for (const property of properties) {
        const original = previous.get(property);
        if (
          original === undefined ||
          popup.style.getPropertyValue(property) !== applied.get(property)
        )
          continue;
        const [value, priority] = original;
        if (value) popup.style.setProperty(property, value, priority);
        else popup.style.removeProperty(property);
      }
      applied.clear();
    };
    const write = (property: string, value: string) => {
      popup.style.setProperty(property, value);
      applied.set(property, popup.style.getPropertyValue(property));
    };
    let maxWidth = "";
    let maxHeight = "";
    const position = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const direction = view.getComputedStyle(trigger).direction;
      const rtl = direction
        ? direction === "rtl"
        : trigger.closest("[dir]")?.getAttribute("dir") === "rtl";
      const origin = currentPoint ?? {
        x: rtl ? triggerRect.right : triggerRect.left,
        y: triggerRect.bottom,
      };
      const viewport = view.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? view.innerWidth;
      const height = viewport?.height ?? view.innerHeight;
      const scale = effectiveZoom(popup);
      const availableWidth = `${Math.max(0, width - 16) / scale}px`;
      const availableHeight = `${Math.max(0, height - 16) / scale}px`;
      write(
        "max-width",
        !maxWidth || maxWidth === "none"
          ? availableWidth
          : `min(${maxWidth}, ${availableWidth})`,
      );
      write(
        "max-height",
        !maxHeight || maxHeight === "none"
          ? availableHeight
          : `min(${maxHeight}, ${availableHeight})`,
      );
      const rect = popup.getBoundingClientRect();
      const x = rtl ? origin.x - rect.width : origin.x;
      const y =
        origin.y + rect.height > top + height - 8
          ? origin.y - rect.height
          : origin.y;
      write(
        "left",
        `${Math.max(left + 8, Math.min(x, left + width - rect.width - 8)) / scale}px`,
      );
      write(
        "top",
        `${Math.max(top + 8, Math.min(y, top + height - rect.height - 8)) / scale}px`,
      );
    };
    reposition = () => {
      // New authored props/classes may change while open. Remove only values
      // still owned by us before reading the author's current constraints.
      restore();
      for (const property of properties)
        previous.set(property, [
          popup.style.getPropertyValue(property),
          popup.style.getPropertyPriority(property),
        ]);
      const authored = view.getComputedStyle(popup);
      maxWidth = authored.maxWidth;
      maxHeight = authored.maxHeight;
      write("position", "fixed");
      write("right", "auto");
      write("bottom", "auto");
      write("margin", "0");
      write("position-area", "none");
      write("box-sizing", "border-box");
      write("overflow", "auto");
      position();
    };
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        position();
      });
    };
    view.addEventListener("resize", schedule);
    view.addEventListener("scroll", schedule, true);
    view.visualViewport?.addEventListener("resize", schedule);
    view.visualViewport?.addEventListener("scroll", schedule);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(popup);
    observer?.observe(trigger);
    return () => {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      view.removeEventListener("resize", schedule);
      view.removeEventListener("scroll", schedule, true);
      view.visualViewport?.removeEventListener("resize", schedule);
      view.visualViewport?.removeEventListener("scroll", schedule);
      observer?.disconnect();
      restore();
    };
  }
  return { sync, stop };
}

/** CSS zoom changes the coordinate space of fixed top-layer descendants. */
function effectiveZoom(node: HTMLElement): number {
  const native = (node as HTMLElement & { currentCSSZoom?: number })
    .currentCSSZoom;
  if (native !== undefined && Number.isFinite(native) && native > 0)
    return native;
  const view = node.ownerDocument.defaultView;
  if (view === null) return 1;
  let zoom = 1;
  let current: Element | null = node;
  while (current !== null) {
    const value = view.getComputedStyle(current).getPropertyValue("zoom");
    const factor = parseFloat(value) / (value.endsWith("%") ? 100 : 1);
    if (Number.isFinite(factor) && factor > 0) zoom *= factor;
    if (current.parentElement !== null) current = current.parentElement;
    else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}
