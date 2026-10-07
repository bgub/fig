import {
  createMixin,
  type FigNode,
  type MixinContext,
  type MixinDescriptor,
  useBeforePaint,
  useMemo,
} from "@bgub/fig";
import { bindPart } from "../internal/parts.ts";
import { createPartSlot } from "../internal/registration.ts";
import { useRegistrationReconcile } from "../internal/reconcile.ts";

export interface TabsIndicatorParts {
  indicator(): MixinDescriptor;
  /** Composes with the matching `tabs.list()` descriptor. */
  list(): MixinDescriptor;
}

export interface TabsIndicatorProps {
  children: (indicator: TabsIndicatorParts) => FigNode;
}

type TabsIndicatorRegistry = ReturnType<typeof createTabsIndicatorRegistry>;

const indicatorListMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, registry: TabsIndicatorRegistry) => ({
    bind: bindPart(context, registry, registry.bindList),
  }),
);

const indicatorMixin = /* @__PURE__ */ createMixin(
  (context: MixinContext, registry: TabsIndicatorRegistry) => ({
    bind: bindPart(context, registry, registry.bindIndicator),
    hidden: true,
    role: "presentation",
  }),
);

/**
 * Optional visual behavior for a tabs widget. The core tabs entry owns only
 * selection and accessibility; this hook measures the active tab and publishes
 * its box as `--active-tab-*` CSS properties.
 */
export function useTabsIndicator(): TabsIndicatorParts {
  const requestReconcile = useRegistrationReconcile();
  const registry = useMemo(
    () => createTabsIndicatorRegistry(requestReconcile),
    [],
  );

  useBeforePaint(() => {
    registry.sync();
  });

  return {
    indicator: () => indicatorMixin(registry),
    list: () => indicatorListMixin(registry),
  };
}

/** {@link useTabsIndicator} as a render-callback component. */
export function TabsIndicator(props: TabsIndicatorProps): FigNode {
  return props.children(useTabsIndicator());
}

function createTabsIndicatorRegistry(registrationChanged: () => void) {
  const indicator = createPartSlot(registrationChanged);
  const list = createPartSlot(registrationChanged);
  let observer: ResizeObserver | null = null;
  let observed: HTMLElement[] = [];

  function bindIndicator(node: HTMLElement, signal: AbortSignal): void {
    if (!indicator.bind(node, signal)) return;
    signal.addEventListener(
      "abort",
      () => {
        if (indicator.node() !== null) return;
        observer?.disconnect();
        observer = null;
      },
      { once: true },
    );
  }

  function sync(): void {
    const listNode = list.node();
    const indicatorNode = indicator.node();
    if (indicatorNode === null) {
      observer?.disconnect();
      observer = null;
      return;
    }
    updatePosition();

    if (typeof ResizeObserver === "undefined") return;
    // Resize delivery must only measure; re-observing would schedule another
    // initial notification even when none of the observed sizes changed.
    if (observer === null) {
      observer = new ResizeObserver(updatePosition);
      observed = [];
    }
    const tabs = ownedTabs(listNode);
    const targets = listNode === null ? tabs : [listNode, ...tabs];
    if (
      targets.length !== observed.length ||
      targets.some((target, index) => target !== observed[index])
    ) {
      observer.disconnect();
      for (const target of targets) observer.observe(target);
      observed = targets;
    }
  }

  function updatePosition(): void {
    const indicatorNode = indicator.node();
    if (indicatorNode === null) return;
    const listNode = list.node();
    const active = ownedTabs(listNode).find(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    positionTabsIndicator(indicatorNode, listNode, active ?? null);
  }

  return {
    bindIndicator,
    bindList: list.bind,
    sync,
  };
}

function ownedTabs(list: HTMLElement | null): HTMLElement[] {
  if (list === null) return [];
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
    (tab) => tab.closest('[role="tablist"]') === list,
  );
}

const edges = ["bottom", "height", "left", "right", "top", "width"] as const;

/** Publishes the active tab's box as `--active-tab-*` custom properties. */
function positionTabsIndicator(
  indicator: HTMLElement,
  list: HTMLElement | null,
  tab: HTMLElement | null,
): void {
  const style = indicator.style;
  if (list === null || tab === null) {
    indicator.hidden = true;
    for (const edge of edges) style.removeProperty(`--active-tab-${edge}`);
    return;
  }

  const tabRect = tab.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const tabStyle = getComputedStyle(tab);
  const listStyle = getComputedStyle(list);
  const width = borderBoxSize(tabStyle, "width", tabRect.width);
  const height = borderBoxSize(tabStyle, "height", tabRect.height);
  // Layout dimensions include scrollbar gutters; computed content-box sizes
  // do not. Dividing by the latter mistakes a scrollbar for extra scaling.
  const listWidth =
    list.offsetWidth || borderBoxSize(listStyle, "width", listRect.width);
  const listHeight =
    list.offsetHeight || borderBoxSize(listStyle, "height", listRect.height);
  const scaleX = listWidth > 0 ? listRect.width / listWidth : 1;
  const scaleY = listHeight > 0 ? listRect.height / listHeight : 1;
  const left = scaleX
    ? (tabRect.left - listRect.left) / scaleX +
      list.scrollLeft -
      list.clientLeft
    : tab.offsetLeft;
  const top = scaleY
    ? (tabRect.top - listRect.top) / scaleY + list.scrollTop - list.clientTop
    : tab.offsetTop;
  const box = {
    bottom: list.scrollHeight - top - height,
    height,
    left,
    right: list.scrollWidth - left - width,
    top,
    width,
  };

  for (const edge of edges) {
    style.setProperty(`--active-tab-${edge}`, `${box[edge]}px`);
  }
  indicator.hidden = !(width > 0 && height > 0);
}

function borderBoxSize(
  style: CSSStyleDeclaration,
  dimension: "width" | "height",
  fallback: number,
): number {
  const size = parseFloat(style[dimension]);
  if (!Number.isFinite(size)) return fallback;
  if (style.boxSizing === "border-box") return size;
  const edges =
    dimension === "width"
      ? (["Left", "Right"] as const)
      : (["Top", "Bottom"] as const);
  return edges.reduce(
    (total, edge) =>
      total +
      (parseFloat(style[`padding${edge}`]) || 0) +
      (parseFloat(style[`border${edge}Width`]) || 0),
    size,
  );
}
