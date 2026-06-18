import {
  createElement,
  type FigNode,
  useExternalStore,
  useMemo,
  useReactive,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import type {
  FigDevtoolsFiberSnapshot,
  FigDevtoolsHookSnapshot,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";
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

type DetailTab = "inspect" | "props" | "hooks" | "context" | "data";
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

const DetailTabs: DetailTab[] = [
  "inspect",
  "props",
  "hooks",
  "context",
  "data",
];
const InitialSelection: Selection = {
  selectedCommitId: null,
  selectedRootId: null,
  selectedFiberId: null,
  tab: "inspect",
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
  const [hover, setHover] = useState<InspectHover | null>(null);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const subscribe = useMemo(() => hook.subscribe.bind(hook), [hook]);
  const getSnapshot = useMemo(() => () => hook.revision, [hook]);
  useExternalStore(subscribe, getSnapshot, () => 0);

  const isOpen = open ?? uncontrolledOpen;
  const snapshot = currentSnapshot(hook, selection);

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) setSelectMode(false);
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useInspectMode(hook, selectMode, setSelection, setSelectMode, setHover);

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
          snapshot,
        })
      : collapsedTab(setOpen),
    isOpen
      ? panelBody(
          hook,
          snapshot,
          selection,
          setSelection,
          banner,
          selectMode,
          commitsOpen,
          setCommitsOpen,
        )
      : null,
    selectMode && hover !== null ? inspectOverlay(hover) : null,
  );
}

interface DevtoolsHeaderOptions {
  selectMode: boolean;
  selection: Selection;
  setOpen: (open: boolean) => void;
  setSelectMode: (selectMode: boolean) => void;
  setSelection: SetSelection;
  snapshot: RenderSnapshot;
}

function devtoolsHeader({
  selectMode,
  selection,
  setOpen,
  setSelectMode,
  setSelection,
  snapshot,
}: DevtoolsHeaderOptions): FigNode {
  return h(
    "header",
    { class: "fig-devtools__header" },
    h(
      "button",
      {
        "aria-label": "Hide Fig DevTools",
        class: "fig-devtools__tab",
        type: "button",
        events: [on("click", () => setOpen(false))],
      },
      h("span", { class: "fig-devtools__mark" }, "Fig"),
    ),
    h(
      "div",
      { class: "fig-devtools__heading" },
      h("strong", { class: "fig-devtools__title" }, "Fig DevTools"),
      h("span", { class: "fig-devtools__subtitle" }, rootStatus(snapshot)),
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
        selectMode,
      ),
      h(
        "span",
        {
          class: classNames("fig-devtools__badge", snapshot.live && "is-live"),
        },
        snapshot.live ? "Live" : "Snapshot",
      ),
      snapshot.live
        ? null
        : button("Resume", () => setSelection(liveSelection(selection))),
      button("Hide", () => setOpen(false)),
    ),
  );
}

function collapsedTab(setOpen: (open: boolean) => void): FigNode {
  return h(
    "button",
    {
      "aria-label": "Show Fig DevTools",
      class: "fig-devtools__collapsed-tab",
      type: "button",
      events: [on("click", () => setOpen(true))],
    },
    h("span", null, "D"),
    h("span", null, "E"),
    h("span", null, "V"),
  );
}

function useInspectMode(
  hook: FigDevtoolsHook,
  selectMode: boolean,
  setSelection: SetSelection,
  setSelectMode: (selectMode: boolean) => void,
  setHover: (hover: InspectHover | null) => void,
): void {
  useReactive(
    (signal) => {
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
        const fiber = findFiber(root?.tree ?? null, inspected.fiberId);
        if (root === undefined || fiber === null) return null;

        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;

        return {
          fiberId: fiber.id,
          label: inspectLabel(root.tree, fiber),
          rect: {
            height: rect.height,
            left: rect.left,
            top: rect.top,
            width: rect.width,
          },
          rootId: inspected.rootId,
        };
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
    [hook, selectMode],
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

function panelBody(
  hook: FigDevtoolsHook,
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
  banner: string | undefined,
  selectMode: boolean,
  commitsOpen: boolean,
  setCommitsOpen: (commitsOpen: boolean) => void,
): FigNode {
  return h(
    "div",
    { class: "fig-devtools__body" },
    h(
      "main",
      { class: "fig-devtools__main" },
      h(
        "div",
        { class: "fig-devtools__tree-pane" },
        treePane(snapshot, selection, setSelection),
      ),
      h(
        "div",
        { class: "fig-devtools__details-pane" },
        detailsPane(snapshot, selection, setSelection),
      ),
    ),
    h(
      "aside",
      {
        class: classNames("fig-devtools__history", commitsOpen && "is-open"),
      },
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
      commitHistory(
        hook,
        snapshot,
        selection,
        setSelection,
        commitsOpen,
        setCommitsOpen,
      ),
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
      events: [
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

function commitList(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
): FigNode {
  if (snapshot.rootCommits.length === 0) {
    return h("p", { class: "fig-devtools__empty" }, "No commits recorded.");
  }

  return h(
    "ol",
    { class: "fig-devtools__commit-list" },
    snapshot.rootCommits.map((commit, index) =>
      h(
        "li",
        { key: commit.id },
        h(
          "button",
          {
            class: classNames(
              "fig-devtools__commit",
              commit.id === selection.selectedCommitId && "is-selected",
            ),
            type: "button",
            events: [
              on("click", () =>
                setSelection(commitSelection(selection, commit)),
              ),
            ],
          },
          h("span", { class: "fig-devtools__commit-id" }, `#${index + 1}`),
          h(
            "span",
            { class: "fig-devtools__commit-meta" },
            `${commit.tree.children.length} ${plural(commit.tree.children.length, "child", "children")}`,
          ),
          h(
            "time",
            { class: "fig-devtools__commit-time" },
            formatCommitTime(commit.committedAt),
          ),
        ),
      ),
    ),
  );
}

function commitHistory(
  hook: FigDevtoolsHook,
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
  commitsOpen: boolean,
  setCommitsOpen: (commitsOpen: boolean) => void,
): FigNode {
  return h(
    "section",
    { class: "fig-devtools__commit-history" },
    h(
      "div",
      { class: "fig-devtools__history-head" },
      h(
        "button",
        {
          "aria-expanded": commitsOpen ? "true" : "false",
          class: "fig-devtools__history-toggle",
          type: "button",
          events: [on("click", () => setCommitsOpen(!commitsOpen))],
        },
        h(
          "span",
          {
            class: classNames(
              "fig-devtools__chevron",
              commitsOpen && "is-open",
            ),
          },
          "›",
        ),
        h("span", null, "Commits"),
        h(
          "span",
          { class: "fig-devtools__commit-count" },
          String(snapshot.rootCommits.length),
        ),
      ),
      commitsOpen
        ? button("Clear", () => {
            hook.clear();
            setSelection(liveSelection(selection));
          })
        : null,
    ),
    commitsOpen
      ? h(
          "div",
          { class: "fig-devtools__history-body" },
          snapshot.roots.length > 1
            ? rootSelector(snapshot, selection, setSelection)
            : null,
          commitList(snapshot, selection, setSelection),
        )
      : null,
  );
}

function treePane(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: SetSelection,
): FigNode {
  if (snapshot.root === null) {
    return h("p", { class: "fig-devtools__empty" }, "Render a Fig root.");
  }

  return h(
    "div",
    { class: "fig-devtools__tree" },
    fiberTree(snapshot.root.tree, 0, selection, setSelection),
  );
}

function fiberTree(
  fiber: FigDevtoolsFiberSnapshot,
  depth: number,
  selection: Selection,
  setSelection: SetSelection,
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
        style: { paddingLeft: `${8 + depth * 14}px` },
        type: "button",
        events: [
          on("click", () => setSelection(fiberSelection(selection, fiber.id))),
        ],
      },
      h("span", { class: `fig-devtools__kind is-${fiber.kind}` }),
      h("span", { class: "fig-devtools__tree-label" }, treeLabel(fiber)),
      fiber.hooks.length === 0
        ? null
        : h("span", { class: "fig-devtools__hook-count" }, fiber.hooks.length),
    ),
    fiber.children.map((child) =>
      fiberTree(child, depth + 1, selection, setSelection),
    ),
  );
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
          events: [
            on("click", () => setSelection(tabSelection(selection, tab))),
          ],
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
  if (tab === "props") return recordSection("Props", fiber.props);
  if (tab === "hooks") return hooksSection(fiber.hooks);
  if (tab === "context")
    return listSection("Context reads", fiber.contextDependencies);
  if (tab === "data") return dataResourcesSection(root?.dataResources ?? []);

  return h(
    "div",
    { class: "fig-devtools__inspect" },
    row("Kind", fiber.kind),
    row("Key", fiber.key === null ? "none" : String(fiber.key)),
    row("Fiber id", String(fiber.id)),
    row("Lanes", `${fiber.lanes} / child ${fiber.childLanes}`),
    fiber.host === undefined ? null : hostSection(fiber),
    fiber.capturedError === undefined
      ? null
      : h(
          "section",
          { class: "fig-devtools__section" },
          h("h3", { class: "fig-devtools__section-title" }, "Error"),
          row("Captured", formatValue(fiber.capturedError)),
          row("Stack", fiber.componentStack?.trim() ?? ""),
        ),
  );
}

function hostSection(fiber: FigDevtoolsFiberSnapshot): FigNode {
  if (fiber.host?.kind === "text") {
    return h(
      "section",
      { class: "fig-devtools__section" },
      h("h3", { class: "fig-devtools__section-title" }, "HTML"),
      h("pre", { class: "fig-devtools__html" }, formatTextNode(fiber)),
    );
  }

  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, "HTML"),
    h("pre", { class: "fig-devtools__html" }, formatElementNode(fiber)),
  );
}

function recordSection(
  title: string,
  record: Record<string, unknown>,
): FigNode {
  const entries = Object.entries(record);

  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, title),
    entries.length === 0
      ? h("p", { class: "fig-devtools__empty" }, "None")
      : entries.map(([key, value]) => row(key, formatValue(value))),
  );
}

function hooksSection(hooks: FigDevtoolsHookSnapshot[]): FigNode {
  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, "Hooks"),
    hooks.length === 0
      ? h("p", { class: "fig-devtools__empty" }, "None")
      : hooks.map((hook) => row(`#${hook.id} ${hook.kind}`, hookValue(hook))),
  );
}

function dataResourcesSection(
  entries: FigDevtoolsRootSnapshot["dataResources"],
): FigNode {
  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, "Data resources"),
    entries.length === 0
      ? h("p", { class: "fig-devtools__empty" }, "None")
      : entries.map(dataResourceSection),
  );
}

function dataResourceSection(entry: DataResourceSnapshot): FigNode {
  return h(
    "div",
    { class: "fig-devtools__section", key: entry.canonicalKey },
    dataResourceRows(entry),
  );
}

function dataResourceRows(entry: DataResourceSnapshot): FigNode[] {
  const rows = [
    row(entry.name ?? entry.canonicalKey, entry.status),
    row("Key", formatValue(entry.key)),
    row("Subscribers", String(entry.subscriberCount)),
    row("Stale", entry.stale ? "yes" : "no"),
  ];

  if (entry.pending) rows.push(row("Pending", "yes"));
  if (entry.hasValue) rows.push(row("Value", formatValue(entry.value)));
  if (entry.error !== undefined)
    rows.push(row("Error", formatValue(entry.error)));
  if (entry.refreshError !== undefined) {
    rows.push(row("Refresh error", formatValue(entry.refreshError)));
  }

  return rows;
}

function listSection(title: string, items: string[]): FigNode {
  return h(
    "section",
    { class: "fig-devtools__section" },
    h("h3", { class: "fig-devtools__section-title" }, title),
    items.length === 0
      ? h("p", { class: "fig-devtools__empty" }, "None")
      : items.map((item) => row("", item)),
  );
}

function row(label: string, value: string): FigNode {
  return h(
    "div",
    { class: "fig-devtools__row" },
    h("span", { class: "fig-devtools__row-label" }, label),
    h("code", { class: "fig-devtools__row-value" }, value),
  );
}

function button(label: string, onClick: () => void, active = false): FigNode {
  return h(
    "button",
    {
      class: classNames("fig-devtools__button", active && "is-active"),
      type: "button",
      events: [on("click", onClick)],
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

function rootStatus(snapshot: RenderSnapshot): string {
  if (snapshot.root === null) return "Waiting for a commit";

  const count = snapshot.root.tree.children.length;
  const commitLabel =
    snapshot.commit === null
      ? "latest commit"
      : `commit #${snapshot.commit.id}`;
  return `Root ${snapshot.root.id} - ${commitLabel} - ${count} ${plural(count, "child", "children")}`;
}

function liveSelection(selection: Selection): Selection {
  return { ...selection, selectedCommitId: null };
}

function inspectedSelection(hover: InspectHover): Selection {
  return {
    selectedCommitId: null,
    selectedFiberId: hover.fiberId,
    selectedRootId: hover.rootId,
    tab: "inspect",
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

function hookValue(hook: FigDevtoolsHookSnapshot): string {
  if (hook.kind === "state") return formatValue(hook.state);
  if (hook.kind === "external-store") return formatValue(hook.state);
  if (hook.kind === "memo") {
    return `${formatValue(hook.state)} deps ${formatValue(hook.deps)}`;
  }

  return `${hook.phase ?? hook.kind} deps ${formatValue(hook.deps)}${hook.active ? " active" : ""}`;
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
  if (tab === "inspect") return "Inspect";
  if (tab === "props") return "Props";
  if (tab === "hooks") return "Hooks";
  if (tab === "context") return "Context";
  return "Data";
}

function classNames(...values: Array<string | false>): string {
  return values.filter(Boolean).join(" ");
}

function formatCommitTime(time: number): string {
  return `${Math.max(0, Math.round(time))}ms`;
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

const h = createElement;
