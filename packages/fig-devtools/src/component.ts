import {
  createElement,
  type FigNode,
  useBeforePaint,
  useSyncExternalStore,
  useMemo,
  useReactive,
  useState,
} from "@bgub/fig";
import { type Bind, on } from "@bgub/fig-dom";
import type {
  FigDevtoolsFiberKind,
  FigDevtoolsFiberSnapshot,
  FigDevtoolsHookSnapshot,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler/devtools";
import {
  ensureFigDevtoolsGlobalHook,
  type FigDevtoolsCommitSnapshot,
  type FigDevtoolsHook,
} from "./hook.ts";
import { DevtoolsStyle } from "./style.ts";

export interface FigDevtoolsProps {
  hook?: FigDevtoolsHook;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: FigDevtoolsPlacement;
  position?: FigDevtoolsPosition;
  banner?: string;
}

export type FigDevtoolsPlacement = "overlay" | "panel" | "sidebar";
export type FigDevtoolsPosition =
  | "BottomRight"
  | "BottomLeft"
  | "TopRight"
  | "TopLeft";

type DetailTab = "details" | "advanced";
type DataResourceSnapshot = FigDevtoolsRootSnapshot["dataResources"][number];

interface Selection {
  selectedCommitId: number | null;
  selectedRootId: number | null;
  selectedFiberId: number | null;
  tab: DetailTab;
}

type SetSelection = (selection: Selection) => void;

interface InspectHover {
  fiberId: number;
  label: string;
  rect: InspectRect;
  rootId: number;
}

interface InspectRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface RenderSnapshot {
  commits: FigDevtoolsCommitSnapshot[];
  rootCommits: FigDevtoolsCommitSnapshot[];
  roots: FigDevtoolsRootSnapshot[];
  root: FigDevtoolsRootSnapshot | null;
  commit: FigDevtoolsCommitSnapshot | null;
  live: boolean;
}

const DetailTabs: DetailTab[] = ["details", "advanced"];
const InitialSelection: Selection = {
  selectedCommitId: null,
  selectedRootId: null,
  selectedFiberId: null,
  tab: "details",
};

export function FigDevtools({
  hook = ensureFigDevtoolsGlobalHook(),
  open,
  defaultOpen = true,
  onOpenChange,
  placement = "overlay",
  position = "BottomRight",
  banner,
}: FigDevtoolsProps): FigNode {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [selection, setSelection] = useState<Selection>(InitialSelection);
  const [selectMode, setSelectMode] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [hover, setHover] = useState<InspectHover | null>(null);
  const [treeHover, setTreeHover] = useState<InspectHover | null>(null);
  const [scrollToken, setScrollToken] = useState(0);
  const subscribe = useMemo(() => hook.subscribe.bind(hook), [hook]);
  const getSnapshot = useMemo(() => () => hook.revision, [hook]);
  useSyncExternalStore(subscribe, getSnapshot, () => 0);

  const treePaneRef = useMemo(() => ({ current: null as Element | null }), []);
  const bindTreePane = useMemo<Bind>(
    () => (node: Element, signal: AbortSignal) => {
      treePaneRef.current = node;
      signal.addEventListener("abort", () => {
        if (treePaneRef.current === node) treePaneRef.current = null;
      });
    },
    [treePaneRef],
  );

  // Reveal the selected node after a select-mode pick lands in the tree.
  // Keyed on scrollToken (bumped by onInspected), not selectedFiberId, so
  // tree clicks and live commits don't yank the scroll position.
  useBeforePaint(() => {
    revealSelectedFiber(treePaneRef.current);
  }, [scrollToken]);

  const isOpen = open ?? uncontrolledOpen;
  const snapshot = currentSnapshot(hook, selection);

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) setSelectMode(false);
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const onFiberHover = (fiber: FigDevtoolsFiberSnapshot | null) => {
    if (fiber === null || snapshot.root === null) {
      setTreeHover(null);
      return;
    }
    setTreeHover(fiberInspectHover(hook, snapshot.root, fiber));
  };

  const onInspected = useMemo(
    () => () => setScrollToken((token) => token + 1),
    [setScrollToken],
  );

  useInspectMode(
    hook,
    selectMode,
    showHost,
    setSelection,
    setSelectMode,
    setHover,
    onInspected,
  );

  return h(
    "section",
    {
      "aria-label": "Fig DevTools",
      "data-fig-devtools": "",
      "data-placement": placement,
      "data-position": position,
      class: classNames(
        "fig-devtools",
        !isOpen && "is-closed",
        placement === "panel" && "is-panel",
        placement === "sidebar" && "is-sidebar",
      ),
    },
    h("style", null, DevtoolsStyle),
    isOpen
      ? devtoolsHeader({
          selectMode,
          selection,
          setOpen,
          setSelectMode,
          setSelection,
          setShowHost,
          showHost,
          snapshot,
        })
      : collapsedTab(setOpen),
    isOpen
      ? panelBody({
          banner,
          bindTreePane,
          onFiberHover,
          selectMode,
          selection,
          setSelection,
          showHost,
          snapshot,
        })
      : null,
    selectMode && hover !== null ? inspectOverlay(hover) : null,
    !selectMode && treeHover !== null ? inspectOverlay(treeHover) : null,
  );
}

interface DevtoolsHeaderOptions {
  selectMode: boolean;
  selection: Selection;
  setOpen: (open: boolean) => void;
  setSelectMode: (selectMode: boolean) => void;
  setSelection: SetSelection;
  setShowHost: (showHost: boolean) => void;
  showHost: boolean;
  snapshot: RenderSnapshot;
}

function devtoolsHeader({
  selectMode,
  selection,
  setOpen,
  setSelectMode,
  setSelection,
  setShowHost,
  showHost,
  snapshot,
}: DevtoolsHeaderOptions): FigNode {
  return h(
    "header",
    { class: "fig-devtools__header" },
    h(
      "div",
      { class: "fig-devtools__heading" },
      h("strong", { class: "fig-devtools__title" }, "Fig DevTools"),
      h("span", {
        "aria-label": snapshot.live ? "Live" : "Snapshot",
        class: classNames("fig-devtools__dot", snapshot.live && "is-live"),
        role: "img",
        title: snapshot.live ? "Live" : "Snapshot",
      }),
    ),
    h(
      "div",
      { class: "fig-devtools__actions" },
      button(
        selectMode ? "Exit Select" : "Select",
        () => {
          if (!selectMode) setSelection(liveSelection(selection));
          setSelectMode(!selectMode);
        },
        { active: selectMode },
      ),
      button("HTML", () => setShowHost(!showHost), {
        active: showHost,
        ariaLabel: hostToggleLabel(showHost),
        ariaPressed: showHost,
        title: hostToggleLabel(showHost),
      }),
      snapshot.live
        ? null
        : button("Resume", () => setSelection(liveSelection(selection))),
      button("✕", () => setOpen(false), {
        ariaLabel: "Hide Fig DevTools",
        className: "fig-devtools__hide",
        title: "Hide Fig DevTools",
      }),
    ),
  );
}

function hostToggleLabel(showHost: boolean): string {
  return showHost ? "Hide HTML elements" : "Show HTML elements";
}

function collapsedTab(setOpen: (open: boolean) => void): FigNode {
  return h(
    "button",
    {
      "aria-label": "Show Fig DevTools",
      class: "fig-devtools__collapsed-tab",
      type: "button",
      mix: [on("click", () => setOpen(true))],
    },
    h("span", null, "D"),
    h("span", null, "E"),
    h("span", null, "V"),
  );
}

function useInspectMode(
  hook: FigDevtoolsHook,
  selectMode: boolean,
  showHost: boolean,
  setSelection: SetSelection,
  setSelectMode: (selectMode: boolean) => void,
  setHover: (hover: InspectHover | null) => void,
  onInspected: () => void,
): void {
  useReactive(
    (signal: AbortSignal) => {
      if (!selectMode) {
        setHover(null);
        return;
      }

      if (typeof document === "undefined") return;

      let lastHoverKey = "";

      const inspect = (target: unknown): InspectHover | null => {
        if (!isElementTarget(target) || isDevtoolsTarget(target)) return null;

        const inspected = hook.inspectElement(target);
        if (inspected === null) return null;

        const root = hook.roots.get(inspected.rootId);
        const inspectedFiber = findFiber(root?.tree ?? null, inspected.fiberId);
        if (root === undefined || inspectedFiber === null) return null;

        const fiber = nearestVisibleFiber(root.tree, inspectedFiber, showHost);
        if (fiber === null) return null;

        return fiberInspectHover(hook, root, fiber);
      };

      const updateHover = (hover: InspectHover | null) => {
        const key =
          hover === null
            ? ""
            : `${hover.rootId}:${hover.fiberId}:${Math.round(hover.rect.left)}:${Math.round(hover.rect.top)}:${Math.round(hover.rect.width)}:${Math.round(hover.rect.height)}`;
        if (key === lastHoverKey) return;

        lastHoverKey = key;
        setHover(hover);
      };

      const onPointerMove = (event: PointerEvent) => {
        updateHover(inspect(event.target));
      };

      const onClick = (event: MouseEvent) => {
        const hover = inspect(event.target);
        if (hover === null) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setSelection(inspectedSelection(hover));
        setSelectMode(false);
        setHover(null);
        onInspected();
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setSelectMode(false);
        setHover(null);
      };

      document.addEventListener("pointermove", onPointerMove, {
        capture: true,
        signal,
      });
      document.addEventListener("click", onClick, { capture: true, signal });
      document.addEventListener("keydown", onKeyDown, { signal });
    },
    [hook, selectMode, showHost, onInspected],
  );
}

function inspectOverlay(hover: InspectHover): FigNode {
  return h(
    "div",
    {
      class: "fig-devtools__inspect-overlay",
      style: {
        height: `${hover.rect.height}px`,
        left: `${hover.rect.left}px`,
        top: `${hover.rect.top}px`,
        width: `${hover.rect.width}px`,
      },
    },
    h(
      "span",
      {
        class: "fig-devtools__inspect-label",
        style: {
          left: "0px",
          top: hover.rect.top < 28 ? `${hover.rect.height + 4}px` : "-26px",
        },
      },
      hover.label,
    ),
  );
}

function isElementTarget(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "getBoundingClientRect" in value &&
    "closest" in value
  );
}

function isDevtoolsTarget(target: Element): boolean {
  return target.closest("[data-fig-devtools]") !== null;
}

function inspectLabel(
  root: FigDevtoolsFiberSnapshot,
  fiber: FigDevtoolsFiberSnapshot,
): string {
  const owner = nearestComponentOwner(root, fiber);
  const host =
    fiber.kind === "host"
      ? `<${fiber.host?.tagName ?? fiber.name}>`
      : fiber.kind === "text"
        ? "#text"
        : fiber.name;

  return owner === null || owner.id === fiber.id
    ? host
    : `${owner.name} - ${host}`;
}

function nearestComponentOwner(
  root: FigDevtoolsFiberSnapshot,
  fiber: FigDevtoolsFiberSnapshot,
): FigDevtoolsFiberSnapshot | null {
  let cursor: FigDevtoolsFiberSnapshot | null = fiber;

  while (cursor !== null) {
    if (
      cursor.kind === "function" ||
      cursor.kind === "suspense" ||
      cursor.kind === "error-boundary" ||
      cursor.kind === "activity" ||
      cursor.kind === "context-provider"
    ) {
      return cursor;
    }

    cursor = findFiber(root, cursor.parentId);
  }

  return null;
}

interface PanelBodyOptions {
  banner: string | undefined;
  bindTreePane: Bind;
  onFiberHover: (fiber: FigDevtoolsFiberSnapshot | null) => void;
  selectMode: boolean;
  selection: Selection;
  setSelection: SetSelection;
  showHost: boolean;
  snapshot: RenderSnapshot;
}

function panelBody({
  banner,
  bindTreePane,
  onFiberHover,
  selectMode,
  selection,
  setSelection,
  showHost,
  snapshot,
}: PanelBodyOptions): FigNode {
  return h(
    "div",
    { class: "fig-devtools__body" },
    h(
      "main",
      { class: "fig-devtools__main" },
      h(
        "div",
        { class: "fig-devtools__tree-pane", bind: bindTreePane },
        treePane(snapshot, selection, setSelection, showHost, onFiberHover),
      ),
      h(
        "div",
        { class: "fig-devtools__details-pane" },
        detailsPane(snapshot, selection, setSelection),
      ),
    ),
    h(
      "aside",
      { class: "fig-devtools__footer" },
      banner === undefined
        ? null
        : h("p", { class: "fig-devtools__banner" }, banner),
      selectMode
        ? h(
            "p",
            { class: "fig-devtools__banner is-selecting" },
            "Select mode is active. Hover an element, click to inspect it, or press Escape.",
          )
        : null,
      timeTravelBar(snapshot, selection, setSelection),
    ),
  );
}

function rootSelector(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
): FigNode {
  return h(
    "select",
    {
      "aria-label": "Select Fig root",
      class: "fig-devtools__root-select",
      value: String(snapshot.root?.id ?? ""),
      mix: [
        on("change", (event: Event) => {
          const target = event.target as HTMLSelectElement;
          const selectedRootId = Number(target.value);
          setSelection(rootSelection(selection, snapshot, selectedRootId));
        }),
      ],
    },
    snapshot.roots.map((root) =>
      h("option", { key: root.id, value: String(root.id) }, `Root ${root.id}`),
    ),
  );
}

// A compact scrubber over the per-root commit history: step backward/forward
// and the Tree/Details panes follow via each commit's captured snapshot.
// Reaching the newest commit resumes live so fresh commits keep flowing in.
function timeTravelBar(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
): FigNode {
  const commits = snapshot.rootCommits;
  const total = commits.length;
  const index = currentCommitIndex(snapshot);
  const shown = snapshot.commit ?? commits.at(-1) ?? null;

  return h(
    "section",
    { class: "fig-devtools__timetravel" },
    button(
      "‹",
      () => setSelection(stepCommit(selection, snapshot, index - 1)),
      {
        ariaLabel: "Previous commit",
        className: "fig-devtools__tt-arrow",
        disabled: index <= 0,
      },
    ),
    h(
      "div",
      { class: "fig-devtools__tt-status" },
      total === 0
        ? h("span", { class: "fig-devtools__tt-empty" }, "No commits yet")
        : h(
            "span",
            { class: "fig-devtools__tt-position" },
            `${index + 1} / ${total}`,
          ),
      total === 0
        ? null
        : h(
            "time",
            { class: "fig-devtools__tt-time" },
            commitTimeLabel(commits, index),
          ),
      total === 0
        ? null
        : snapshot.live
          ? h("span", { class: "fig-devtools__tt-state is-live" }, "live")
          : h("span", { class: "fig-devtools__tt-state" }, "snapshot"),
      shown === null ? null : workBadges(shown),
    ),
    snapshot.roots.length > 1
      ? rootSelector(snapshot, selection, setSelection)
      : null,
    button(
      "›",
      () => setSelection(stepCommit(selection, snapshot, index + 1)),
      {
        ariaLabel: "Next commit",
        className: "fig-devtools__tt-arrow",
        disabled: total === 0 || snapshot.live,
      },
    ),
  );
}

function currentCommitIndex(snapshot: RenderSnapshot): number {
  const total = snapshot.rootCommits.length;
  if (total === 0) return -1;
  if (snapshot.commit === null) return total - 1;

  const index = snapshot.rootCommits.findIndex(
    (commit) => commit.id === snapshot.commit?.id,
  );
  return index === -1 ? total - 1 : index;
}

function stepCommit(
  selection: Selection,
  snapshot: RenderSnapshot,
  index: number,
): Selection {
  const commits = snapshot.rootCommits;
  if (commits.length === 0) return selection;

  const clamped = Math.max(0, Math.min(index, commits.length - 1));
  // Landing on the newest commit resumes live so the panes keep following
  // later commits instead of pinning to a soon-to-be-stale id.
  if (clamped === commits.length - 1) return liveSelection(selection);
  return commitSelection(selection, commits[clamped]);
}

function workBadges(commit: FigDevtoolsCommitSnapshot): FigNode | null {
  const labels = commitWorkLabels(commit);
  if (labels.length === 0) return null;

  return h(
    "span",
    { class: "fig-devtools__tt-badges" },
    labels.map((label) =>
      h(
        "span",
        { class: `fig-devtools__tt-badge is-${label}`, key: label },
        label,
      ),
    ),
  );
}

function commitWorkLabels(commit: FigDevtoolsCommitSnapshot): string[] {
  const root = commit.root;
  const labels = new Set<string>();
  for (const label of root.pendingWork) labels.add(label);
  for (const label of root.suspendedWork) labels.add(label);
  for (const label of root.pingedWork) labels.add(label);
  for (const label of root.expiredWork) labels.add(label);
  return [...labels];
}

function treePane(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
  showHost: boolean,
  onFiberHover: (fiber: FigDevtoolsFiberSnapshot | null) => void,
): FigNode {
  if (snapshot.root === null) {
    return h("p", { class: "fig-devtools__empty" }, "Render a Fig root.");
  }

  return h(
    "div",
    {
      class: "fig-devtools__tree",
      mix: [on("pointerleave", () => onFiberHover(null))],
    },
    fiberTree(
      snapshot.root.tree,
      0,
      selection,
      setSelection,
      showHost,
      onFiberHover,
    ),
  );
}

function fiberTree(
  fiber: FigDevtoolsFiberSnapshot,
  depth: number,
  selection: Selection,
  setSelection: SetSelection,
  showHost: boolean,
  onFiberHover: (fiber: FigDevtoolsFiberSnapshot | null) => void,
): FigNode {
  return h(
    "div",
    { class: "fig-devtools__tree-node", key: fiber.id },
    h(
      "button",
      {
        class: classNames(
          "fig-devtools__tree-button",
          fiber.id === selection.selectedFiberId && "is-selected",
        ),
        type: "button",
        mix: [
          on("click", () => setSelection(fiberSelection(selection, fiber.id))),
          on("pointerenter", () => onFiberHover(fiber)),
        ],
      },
      indentGuides(depth),
      h(
        "span",
        { class: "fig-devtools__tree-row" },
        h("span", { class: `fig-devtools__kind is-${fiber.kind}` }),
        h("span", { class: "fig-devtools__tree-label" }, treeLabel(fiber)),
        fiber.hooks.length === 0
          ? null
          : h(
              "span",
              { class: "fig-devtools__hook-count" },
              fiber.hooks.length,
            ),
        fiber.dataResourceCanonicalKeys.length === 0
          ? null
          : h(
              "span",
              { class: "fig-devtools__data-count" },
              fiber.dataResourceCanonicalKeys.length,
            ),
      ),
    ),
    visibleChildren(fiber, showHost).map((child) =>
      fiberTree(
        child,
        depth + 1,
        selection,
        setSelection,
        showHost,
        onFiberHover,
      ),
    ),
  );
}

function isHostKind(kind: FigDevtoolsFiberKind): boolean {
  return kind === "host" || kind === "text";
}

function nearestVisibleFiber(
  root: FigDevtoolsFiberSnapshot,
  fiber: FigDevtoolsFiberSnapshot,
  showHost: boolean,
): FigDevtoolsFiberSnapshot | null {
  if (showHost) return fiber;

  let cursor: FigDevtoolsFiberSnapshot | null = fiber;
  while (cursor !== null && isHostKind(cursor.kind)) {
    cursor = findFiber(root, cursor.parentId);
  }
  return cursor;
}

function fiberInspectHover(
  hook: FigDevtoolsHook,
  root: FigDevtoolsRootSnapshot,
  fiber: FigDevtoolsFiberSnapshot,
): InspectHover | null {
  const rect = fiberScreenRect(hook, root.id, fiber);
  if (rect === null) return null;

  return {
    fiberId: fiber.id,
    label: inspectLabel(root.tree, fiber),
    rect,
    rootId: root.id,
  };
}

function fiberScreenRect(
  hook: FigDevtoolsHook,
  rootId: number,
  fiber: FigDevtoolsFiberSnapshot,
): InspectRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  const visit = (node: FigDevtoolsFiberSnapshot): void => {
    if (isHostKind(node.kind)) {
      const element = hook.elementForFiber(rootId, node.id);
      if (isElementTarget(element)) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          left = Math.min(left, rect.left);
          top = Math.min(top, rect.top);
          right = Math.max(right, rect.left + rect.width);
          bottom = Math.max(bottom, rect.top + rect.height);
        }
      }
    }
    for (const child of node.children) visit(child);
  };

  visit(fiber);
  if (!Number.isFinite(left)) return null;

  return { height: bottom - top, left, top, width: right - left };
}

function revealSelectedFiber(treePane: Element | null): void {
  const selected = treePane?.querySelector(
    ".fig-devtools__tree-button.is-selected",
  );
  if (selected === null || selected === undefined) return;
  selected.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function visibleChildren(
  fiber: FigDevtoolsFiberSnapshot,
  showHost: boolean,
): FigDevtoolsFiberSnapshot[] {
  if (showHost) return fiber.children;

  const visible: FigDevtoolsFiberSnapshot[] = [];
  for (const child of fiber.children) {
    if (isHostKind(child.kind)) {
      visible.push(...visibleChildren(child, showHost));
    } else {
      visible.push(child);
    }
  }
  return visible;
}

function indentGuides(depth: number): FigNode {
  // One rail element per row; a repeating gradient (see style.ts) draws one
  // guide line per depth level, so this stays O(1) nodes regardless of depth.
  return h("span", {
    class: "fig-devtools__tree-rails",
    style: { "--fig-devtools-depth": String(depth) },
  });
}

function detailsPane(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
): FigNode {
  const fiber =
    findFiber(snapshot.root?.tree ?? null, selection.selectedFiberId) ??
    snapshot.root?.tree ??
    null;

  if (fiber === null) {
    return h("p", { class: "fig-devtools__empty" }, "No fiber selected.");
  }

  return h(
    "section",
    { class: "fig-devtools__details" },
    h(
      "div",
      { class: "fig-devtools__details-head" },
      h("h2", { class: "fig-devtools__name" }, fiber.name),
      h("span", { class: "fig-devtools__chip" }, fiber.kind),
    ),
    tabBar(selection, setSelection),
    detailTab(selection.tab, fiber, snapshot.root),
  );
}

function tabBar(selection: Selection, setSelection: SetSelection): FigNode {
  return h(
    "div",
    { class: "fig-devtools__tabs", role: "tablist" },
    DetailTabs.map((tab) =>
      h(
        "button",
        {
          "aria-selected": tab === selection.tab ? "true" : "false",
          class: classNames(
            "fig-devtools__tab-button",
            tab === selection.tab && "is-selected",
          ),
          role: "tab",
          type: "button",
          mix: [on("click", () => setSelection(tabSelection(selection, tab)))],
        },
        tabLabel(tab),
      ),
    ),
  );
}

function detailTab(
  tab: DetailTab,
  fiber: FigDevtoolsFiberSnapshot,
  root: FigDevtoolsRootSnapshot | null,
): FigNode {
  return tab === "advanced" ? advancedTab(fiber) : detailsTab(fiber, root);
}

// The everyday view: props, hooks, and (when present) context and data,
// stacked so the common questions are answered without switching tabs.
function detailsTab(
  fiber: FigDevtoolsFiberSnapshot,
  root: FigDevtoolsRootSnapshot | null,
): FigNode {
  return h(
    "div",
    { class: "fig-devtools__inspect" },
    propsSection(fiber.props),
    hooksSection(fiber.hooks),
    contextSection(fiber.contextDependencies),
    dataResourcesSection(dataResourcesForFiber(fiber, root)),
  );
}

function dataResourcesForFiber(
  fiber: FigDevtoolsFiberSnapshot,
  root: FigDevtoolsRootSnapshot | null,
): FigDevtoolsRootSnapshot["dataResources"] {
  if (root === null) return [];
  // The root lists the whole store: entries with no committed subscriber
  // (unclaimed preloads, hydrated-but-unread rows) appear nowhere else.
  if (fiber.kind === "root") return root.dataResources;
  if (fiber.dataResourceCanonicalKeys.length === 0) return [];

  const keys = new Set(fiber.dataResourceCanonicalKeys);
  return root.dataResources.filter((entry) => keys.has(entry.canonicalKey));
}

// The low-level fiber internals, tucked away from the everyday view.
function advancedTab(fiber: FigDevtoolsFiberSnapshot): FigNode {
  return h(
    "div",
    { class: "fig-devtools__inspect" },
    section("Fiber", [
      row("Kind", fiber.kind),
      row("Key", fiber.key === null ? "none" : String(fiber.key)),
      row("Fiber id", String(fiber.id)),
      row("Work", formatWork(fiber.pendingWork, fiber.childWork)),
    ]),
    fiber.host === undefined ? null : hostSection(fiber),
    fiber.capturedError === undefined
      ? null
      : section("Error", [
          row("Captured", formatValue(fiber.capturedError)),
          row("Stack", fiber.componentStack?.trim() ?? ""),
        ]),
  );
}

function section(title: string, body: FigNode | FigNode[]): FigNode {
  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, title),
    body,
  );
}

function propsSection(props: Record<string, unknown>): FigNode {
  const entries = Object.entries(props);
  return section(
    "Props",
    entries.length === 0
      ? emptyNote("No props")
      : entries.map(([key, value]) => kvRow(key, value)),
  );
}

function hooksSection(hooks: FigDevtoolsHookSnapshot[]): FigNode {
  return section(
    "Hooks",
    hooks.length === 0
      ? emptyNote("No hooks")
      : hooks.map((hook, index) => hookRow(hook, index)),
  );
}

function hookRow(hook: FigDevtoolsHookSnapshot, index: number): FigNode {
  return h(
    "div",
    { class: "fig-devtools__hook", key: hook.id },
    h(
      "div",
      { class: "fig-devtools__hook-head" },
      h("span", { class: "fig-devtools__hook-index" }, String(index + 1)),
      h("span", { class: "fig-devtools__hook-kind" }, hook.kind),
      hook.phase === undefined
        ? null
        : h("span", { class: "fig-devtools__hook-tag" }, hook.phase),
      hook.active
        ? h("span", { class: "fig-devtools__hook-tag is-active" }, "active")
        : null,
      hook.state === undefined ? null : valueCode(hook.state),
    ),
    hook.deps === undefined || hook.deps === null
      ? null
      : h(
          "div",
          { class: "fig-devtools__hook-deps" },
          h("span", { class: "fig-devtools__row-label" }, "deps"),
          valueCode(hook.deps),
        ),
  );
}

function contextSection(items: string[]): FigNode | null {
  if (items.length === 0) return null;
  return section(
    "Context",
    h(
      "div",
      { class: "fig-devtools__chips" },
      items.map((name) =>
        h("span", { class: "fig-devtools__value-chip", key: name }, name),
      ),
    ),
  );
}

function dataResourcesSection(
  entries: FigDevtoolsRootSnapshot["dataResources"],
): FigNode | null {
  if (entries.length === 0) return null;
  return section("Data", entries.map(dataResourceSection));
}

function dataResourceSection(entry: DataResourceSnapshot): FigNode {
  return h(
    "div",
    { class: "fig-devtools__data", key: entry.canonicalKey },
    dataResourceRows(entry),
  );
}

function dataResourceRows(entry: DataResourceSnapshot): FigNode[] {
  const rows = [
    kvRow(entry.canonicalKey, entry.status),
    kvRow("Key", entry.key),
    row("Subscribers", String(entry.subscriberCount)),
    row("Stale", entry.stale ? "yes" : "no"),
  ];

  if (entry.pending && entry.status !== "refreshing") {
    rows.push(row("Pending", "yes"));
  }
  if (entry.hasValue) rows.push(kvRow("Value", entry.value));
  if (entry.error !== undefined) rows.push(kvRow("Error", entry.error));
  if (entry.refreshError !== undefined) {
    rows.push(kvRow("Refresh error", entry.refreshError));
  }

  return rows;
}

function emptyNote(text: string): FigNode {
  return h("p", { class: "fig-devtools__empty" }, text);
}

function hostSection(fiber: FigDevtoolsFiberSnapshot): FigNode {
  const html =
    fiber.host?.kind === "text"
      ? formatTextNode(fiber)
      : formatElementNode(fiber);
  return section("HTML", h("pre", { class: "fig-devtools__html" }, html));
}

function formatWork(
  pending: readonly string[],
  children: readonly string[],
): string {
  const own = pending.length === 0 ? "none" : pending.join(", ");
  const child = children.length === 0 ? "none" : children.join(", ");
  return `${own} / child ${child}`;
}

// A labelled value with light per-type coloring; the everyday sections use
// this so props/hooks/data read at a glance.
function kvRow(label: string, value: unknown): FigNode {
  return h(
    "div",
    { class: "fig-devtools__row" },
    h("span", { class: "fig-devtools__row-label" }, label),
    valueCode(value),
  );
}

function valueCode(value: unknown): FigNode {
  return h(
    "code",
    { class: classNames("fig-devtools__row-value", valueTypeClass(value)) },
    formatValue(value),
  );
}

function valueTypeClass(value: unknown): string {
  if (value === null || value === undefined) return "is-nullish";
  const type = typeof value;
  if (type === "string") return "is-string";
  if (type === "number" || type === "bigint") return "is-number";
  if (type === "boolean") return "is-boolean";
  if (type === "function") return "is-function";
  return "is-object";
}

function row(label: string, value: string): FigNode {
  return h(
    "div",
    { class: "fig-devtools__row" },
    h("span", { class: "fig-devtools__row-label" }, label),
    h("code", { class: "fig-devtools__row-value" }, value),
  );
}

interface ButtonOptions {
  active?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  className?: string | false;
  disabled?: boolean;
  title?: string;
}

function button(
  label: string,
  onClick: () => void,
  options: ButtonOptions = {},
): FigNode {
  const {
    active = false,
    ariaLabel,
    ariaPressed,
    className,
    disabled,
    title,
  } = options;
  return h(
    "button",
    {
      "aria-label": ariaLabel,
      "aria-pressed":
        ariaPressed === undefined ? undefined : String(ariaPressed),
      class: classNames(
        "fig-devtools__button",
        className,
        active && "is-active",
      ),
      disabled: disabled === true ? true : undefined,
      title,
      type: "button",
      mix: [on("click", onClick)],
    },
    label,
  );
}

function currentSnapshot(
  hook: FigDevtoolsHook,
  selection: Selection,
): RenderSnapshot {
  const commits = hook.commits;
  const roots = [...hook.roots.values()].sort(
    (left, right) => left.committedAt - right.committedAt,
  );
  const selectedCommit =
    selection.selectedCommitId === null
      ? null
      : (commits.find((commit) => commit.id === selection.selectedCommitId) ??
        null);
  const selectedRoot =
    selectedCommit?.root ??
    roots.find((root) => root.id === selection.selectedRootId) ??
    roots.at(-1) ??
    null;
  const rootCommits =
    selectedRoot === null
      ? []
      : commits.filter((commit) => commit.rootId === selectedRoot.id);

  return {
    commits,
    rootCommits,
    roots,
    root: selectedRoot,
    commit: selectedCommit,
    live: selectedCommit === null,
  };
}

function liveSelection(selection: Selection): Selection {
  return { ...selection, selectedCommitId: null };
}

function inspectedSelection(hover: InspectHover): Selection {
  return {
    selectedCommitId: null,
    selectedFiberId: hover.fiberId,
    selectedRootId: hover.rootId,
    tab: "details",
  };
}

function rootSelection(
  selection: Selection,
  snapshot: RenderSnapshot,
  selectedRootId: number,
): Selection {
  return {
    ...selection,
    selectedCommitId: null,
    selectedRootId,
    selectedFiberId:
      snapshot.roots.find((root) => root.id === selectedRootId)?.tree.id ??
      null,
  };
}

function commitSelection(
  selection: Selection,
  commit: FigDevtoolsCommitSnapshot,
): Selection {
  return {
    ...selection,
    selectedCommitId: commit.id,
    selectedRootId: commit.rootId,
    selectedFiberId: commit.tree.id,
  };
}

function fiberSelection(
  selection: Selection,
  selectedFiberId: number,
): Selection {
  return { ...selection, selectedFiberId };
}

function tabSelection(selection: Selection, tab: DetailTab): Selection {
  return { ...selection, tab };
}

function findFiber(
  fiber: FigDevtoolsFiberSnapshot | null,
  id: number | null,
): FigDevtoolsFiberSnapshot | null {
  if (fiber === null || id === null) return null;
  if (fiber.id === id) return fiber;

  for (const child of fiber.children) {
    const found = findFiber(child, id);
    if (found !== null) return found;
  }

  return null;
}

function treeLabel(fiber: FigDevtoolsFiberSnapshot): string {
  const key = fiber.key === null ? "" : ` key=${String(fiber.key)}`;
  return `${fiber.name}${key}`;
}

function formatElementNode(fiber: FigDevtoolsFiberSnapshot): string {
  const tagName = fiber.host?.tagName ?? fiber.name;
  const attributes = Object.entries(fiber.host?.attributes ?? {});
  const props = attributes
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(" ");
  const suffix = props === "" ? "" : ` ${props}`;
  return `<${tagName}${suffix}>`;
}

function formatTextNode(fiber: FigDevtoolsFiberSnapshot): string {
  return JSON.stringify(fiber.host?.text ?? fiber.props.nodeValue ?? "");
}

function formatValue(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(truncate(value));
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "bigint") return `${String(value)}n`;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return `[${value.name}: ${value.message}]`;

  if (seen.has(value)) return "[Circular]";
  if (depth > 2) return Array.isArray(value) ? "[Array]" : "[Object]";

  seen.add(value);

  if (Array.isArray(value)) {
    const values = value
      .slice(0, 4)
      .map((item) => formatValue(item, depth + 1, seen));
    const suffix = value.length > 4 ? ", ..." : "";
    return `[${values.join(", ")}${suffix}]`;
  }

  const node = value as { nodeType?: unknown; nodeName?: unknown };
  if (typeof node.nodeType === "number" && typeof node.nodeName === "string") {
    return `<${node.nodeName.toLowerCase()}>`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).slice(0, 4);
  const suffix = Object.keys(record).length > 4 ? ", ..." : "";
  const body = entries
    .map(([key, item]) => `${key}: ${formatValue(item, depth + 1, seen)}`)
    .join(", ");

  return `{ ${body}${suffix} }`;
}

function tabLabel(tab: DetailTab): string {
  return tab === "details" ? "Details" : "Advanced";
}

function classNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

// committedAt is a performance.now() timestamp (ms since page load), which is
// meaningless on its own; show each commit's gap from the previous one so the
// column reads as a cadence timeline instead of raw uptime.
function commitTimeLabel(
  commits: FigDevtoolsCommitSnapshot[],
  index: number,
): string {
  const previous = commits[index - 1];
  if (previous === undefined) return "—";
  return `+${formatDuration(commits[index].committedAt - previous.committedAt)}`;
}

function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)}s`;
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

const h = createElement;
