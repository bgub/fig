import {
  createMixin,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
} from "@bgub/fig";
import { bindPart } from "../internal/parts.ts";
import { observePopupAnchor } from "../internal/popup-anchor.ts";
import { createPartSlot } from "../internal/registration.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export interface PopupPositionOptions {
  /** Match the popup widget's committed open state. */
  open: boolean;
  /** Preferred side in horizontal writing modes. Defaults to bottom. */
  side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
  /** Alignment along the side. Defaults to start. */
  align?: "start" | "center" | "end";
  /** Distance from the anchor in CSS pixels. Defaults to 4; may be negative. */
  sideOffset?: number;
  /** Cross-axis offset in CSS pixels; end alignment reverses its sign. Defaults to 0. */
  alignOffset?: number;
  /** Space to reserve at each viewport edge, in CSS pixels. Defaults to 4. */
  collisionPadding?: number;
  /** Check anchor bounds every frame for transform animations. Defaults to false. */
  trackAnchorAnimation?: boolean;
}

export interface PopupPositionParts {
  anchor(): MixinDescriptor;
  popup(): MixinDescriptor;
}

type PositionRegistry = ReturnType<typeof createPositionRegistry>;
type Side = "top" | "bottom" | "left" | "right";

const anchorMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, registry: PositionRegistry) => ({
    bind: bindPart(context, registry, registry.anchor.bind),
  }),
);
const popupMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, registry: PositionRegistry) => ({
    bind: bindPart(context, registry, registry.bindPopup),
  }),
);

/** Optional viewport positioning for native top-layer popups. */
export function usePopupPosition(
  options: PopupPositionOptions,
): PopupPositionParts {
  const changed = useRegistrationReconcile();
  const registry = useMemo(() => createPositionRegistry(changed), []);
  useBeforePaint((signal) => {
    const anchor = registry.anchor.node();
    const popup = registry.popup.node();
    const styles = registry.styles;
    if (
      !options.open ||
      anchor === null ||
      popup === null ||
      styles === undefined
    )
      return;
    const window = anchor.ownerDocument.defaultView;
    if (window === null) return;
    let frame = 0;
    let clipped = false;
    const update = () => {
      if (!signal.aborted) position(anchor, popup, styles, options, clipped);
    };
    const schedule = () => {
      if (signal.aborted || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        checkAnchor();
        update();
      });
    };
    update();
    const observer = new window.ResizeObserver(schedule);
    observer.observe(popup);
    for (
      let node: Element | null = anchor;
      node !== null;
      node = node.parentElement
    ) {
      observer.observe(node);
    }
    const checkAnchor = observePopupAnchor(
      anchor,
      update,
      (hidden) => {
        clipped = hidden;
        update();
      },
      signal,
      options.trackAnchorAnimation ?? false,
    );
    const events = { signal, passive: true };
    anchor.ownerDocument.addEventListener(
      "scroll",
      (event) => {
        // Scrolling this popup changes its contents, not its placement. Nested
        // popup positioners still observe it as an ancestor scroll target.
        if (event.target !== popup) schedule();
      },
      { ...events, capture: true },
    );
    window.addEventListener("resize", schedule, events);
    window.visualViewport?.addEventListener("resize", schedule, events);
    window.visualViewport?.addEventListener("scroll", schedule, events);
    signal.addEventListener(
      "abort",
      () => {
        observer.disconnect();
        window.cancelAnimationFrame(frame);
      },
      { once: true },
    );
  });
  return {
    anchor: () => anchorMixin(registry),
    popup: () => popupMixin(registry),
  };
}

/** Restore authored values before measuring; retain new inline styles from rerenders. */
function ownStyles(node: HTMLElement, signal: AbortSignal) {
  const saved = new Map<
    string,
    { value: string; priority: string; written: string }
  >();
  function restore(key: string): void {
    const previous = saved.get(key);
    if (previous === undefined) return;
    if (
      node.style.getPropertyValue(key) === previous.written &&
      node.style.getPropertyPriority(key) === ""
    ) {
      if (previous.value)
        node.style.setProperty(key, previous.value, previous.priority);
      else node.style.removeProperty(key);
    }
    saved.delete(key);
  }
  function set(key: string, value: string): void {
    if (
      saved.get(key)?.written === value &&
      node.style.getPropertyValue(key) === value &&
      node.style.getPropertyPriority(key) === ""
    )
      return;
    restore(key);
    const previous = {
      value: node.style.getPropertyValue(key),
      priority: node.style.getPropertyPriority(key),
      written: value,
    };
    node.style.setProperty(key, value);
    previous.written = node.style.getPropertyValue(key);
    saved.set(key, previous);
  }
  signal.addEventListener(
    "abort",
    () => {
      for (const key of saved.keys()) restore(key);
    },
    { once: true },
  );
  return { set, restore };
}

function createPositionRegistry(changed: () => void) {
  const anchor = createPartSlot(changed);
  const popup = createPartSlot(changed);
  const registry: {
    anchor: typeof anchor;
    popup: typeof popup;
    bindPopup: typeof bindPopup;
    styles?: ReturnType<typeof ownStyles>;
  } = { anchor, popup, bindPopup };
  function bindPopup(node: HTMLElement, signal: AbortSignal): void {
    if (!popup.bind(node, signal)) return;
    const styles = ownStyles(node, signal);
    registry.styles = styles;
    const attributes = ["data-side", "data-align", "data-anchor-hidden"].map(
      (key) => [key, node.getAttribute(key)] as const,
    );
    signal.addEventListener(
      "abort",
      () => {
        for (const [key, value] of attributes) {
          if (value === null) node.removeAttribute(key);
          else node.setAttribute(key, value);
        }
      },
      { once: true },
    );
    // Prepare while closed too: showPopover() must not expose broken native
    // anchor coordinates and scroll focus there before our layout pass.
    for (const [key, value] of Object.entries({
      position: "fixed",
      "position-area": "none",
      "position-try-fallbacks": "none",
      top: "4px",
      left: "4px",
      right: "auto",
      bottom: "auto",
      "margin-top": "0px",
      "margin-right": "0px",
      "margin-bottom": "0px",
      "margin-left": "0px",
      "overflow-x": "auto",
      "overflow-y": "auto",
      "box-sizing": "border-box",
    }))
      styles.set(key, value);
  }
  return registry;
}

function position(
  anchor: HTMLElement,
  popup: HTMLElement,
  styles: ReturnType<typeof ownStyles>,
  options: PopupPositionOptions,
  clipped: boolean,
): void {
  const window = anchor.ownerDocument.defaultView!;
  const viewport = window.visualViewport;
  const width =
    viewport?.width ?? anchor.ownerDocument.documentElement.clientWidth;
  const height =
    viewport?.height ?? anchor.ownerDocument.documentElement.clientHeight;
  const padding = Math.max(0, options.collisionPadding ?? 4);
  const px = Math.min(padding, width / 2);
  const py = Math.min(padding, height / 2);
  const left = (viewport?.offsetLeft ?? 0) + px;
  const top = (viewport?.offsetTop ?? 0) + py;
  const right = left + width - 2 * px;
  const bottom = top + height - 2 * py;
  const offset = options.sideOffset ?? 4;
  const rtl = window.getComputedStyle(anchor).direction === "rtl";
  const a = anchor.getBoundingClientRect();
  popup.toggleAttribute(
    "data-anchor-hidden",
    clipped ||
      a.width === 0 ||
      a.height === 0 ||
      a.right <= left - px ||
      a.left >= right + px ||
      a.bottom <= top - py ||
      a.top >= bottom + py,
  );
  const align = options.align ?? "start";
  let side = options.side ?? "bottom";
  if (side === "inline-end") side = rtl ? "left" : "right";
  if (side === "inline-start") side = rtl ? "right" : "left";
  const space = {
    top: clamp(a.top - top - offset, 0, bottom - top),
    bottom: clamp(bottom - a.bottom - offset, 0, bottom - top),
    left: clamp(a.left - left - offset, 0, right - left),
    right: clamp(right - a.right - offset, 0, right - left),
  };
  const opposite: Record<Side, Side> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  styles.set("--anchor-width", `${a.width}px`);
  styles.set("--anchor-height", `${a.height}px`);
  styles.set("--available-width", `${right - left}px`);
  styles.set("--available-height", `${bottom - top}px`);
  const scrollTop = popup.scrollTop;
  const scrollLeft = popup.scrollLeft;
  styles.restore("max-width");
  styles.restore("max-height");
  const computed = window.getComputedStyle(popup);
  const maxWidth = computed.maxWidth;
  const maxHeight = computed.maxHeight;
  function constrain(w: number, h: number): void {
    styles.set("--available-width", `${Math.max(0, w)}px`);
    styles.set("--available-height", `${Math.max(0, h)}px`);
    styles.set(
      "max-width",
      maxWidth === "none" || !maxWidth
        ? `${Math.max(0, w)}px`
        : `min(${maxWidth}, ${Math.max(0, w)}px)`,
    );
    styles.set(
      "max-height",
      maxHeight === "none" || !maxHeight
        ? `${Math.max(0, h)}px`
        : `min(${maxHeight}, ${Math.max(0, h)}px)`,
    );
  }
  constrain(right - left, bottom - top);
  let box = popup.getBoundingClientRect();
  let vertical = side === "top" || side === "bottom";
  const size = vertical ? box.height : box.width;
  if (size > space[side] && space[opposite[side]] > space[side])
    side = opposite[side];
  // Keep the useful submenu fallback: stack vertically if neither horizontal
  // side has room, rather than squeeze a readable menu into a narrow column.
  if (!vertical && box.width > space[side]) {
    side =
      space.bottom >= box.height || space.bottom >= space.top
        ? "bottom"
        : "top";
    vertical = true;
  }
  constrain(
    vertical ? right - left : space[side],
    vertical ? space[side] : bottom - top,
  );
  // Metadata can affect CSS dimensions, so publish it before the final measure.
  const logical =
    options.side === "inline-start" || options.side === "inline-end";
  const renderedSide =
    logical && !vertical
      ? (side === "left") !== rtl
        ? "inline-start"
        : "inline-end"
      : side;
  popup.setAttribute("data-side", renderedSide);
  popup.setAttribute("data-align", align);
  box = popup.getBoundingClientRect();
  // Relaxing constraints for measurement can clamp scroll offsets. Restore
  // them against the final dimensions so keyboard and pointer scrolling stick.
  popup.scrollTop = scrollTop;
  popup.scrollLeft = scrollLeft;
  const start = vertical ? a.left : a.top;
  const end = vertical ? a.right : a.bottom;
  const crossSize = vertical ? box.width : box.height;
  const reversed = vertical && rtl;
  const fromEnd = (align === "end") !== reversed;
  let cross =
    align === "center"
      ? (start + end - crossSize) / 2
      : fromEnd
        ? end - crossSize
        : start;
  // Base UI offsets start toward the interior and end toward the interior's
  // opposite direction; center follows the cross axis (RTL-aware vertically).
  const alignSign = align === "end" ? -1 : 1;
  cross += (options.alignOffset ?? 0) * alignSign * (reversed ? -1 : 1);
  let x = vertical
    ? cross
    : side === "left"
      ? a.left - offset - box.width
      : a.right + offset;
  let y = vertical
    ? side === "top"
      ? a.top - offset - box.height
      : a.bottom + offset
    : cross;
  x = clamp(x, left, right - box.width);
  y = clamp(y, top, bottom - box.height);
  styles.set("left", `${x}px`);
  styles.set("top", `${y}px`);
  // Arrowless aligned popups grow from the aligned edge. Once shifted, aim
  // toward the anchor's center instead, matching Base UI's origin convention.
  const crossOrigin =
    align !== "center" && Math.abs((vertical ? x : y) - cross) <= 1
      ? fromEnd
        ? crossSize
        : 0
      : clamp((start + end) / 2 - (vertical ? x : y), 0, crossSize);
  const originX = vertical
    ? crossOrigin
    : (side === "left" ? a.left : a.right) - x;
  const originY = vertical
    ? (side === "top" ? a.top : a.bottom) - y
    : crossOrigin;
  styles.set("--transform-origin", `${originX}px ${originY}px`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
