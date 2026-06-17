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

type DetailTab = "inspect" | "props" | "hooks" | "context";

interface Selection {
  selectedCommitId: number | null;
  selectedRootId: number | null;
  selectedFiberId: number | null;
  tab: DetailTab;
}

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
  roots: FigDevtoolsRootSnapshot[];
  root: FigDevtoolsRootSnapshot | null;
  commit: FigDevtoolsCommitSnapshot | null;
  live: boolean;
}

const DetailTabs: DetailTab[] = ["inspect", "props", "hooks", "context"];

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
  const [selection, setSelection] = useState<Selection>({
    selectedCommitId: null,
    selectedRootId: null,
    selectedFiberId: null,
    tab: "inspect",
  });
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
      ? h(
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
            h(
              "span",
              { class: "fig-devtools__subtitle" },
              rootStatus(snapshot),
            ),
          ),
          h(
            "div",
            { class: "fig-devtools__actions" },
            button(
              selectMode ? "Exit Select" : "Select",
              () => {
                if (!selectMode) {
                  setSelection({ ...selection, selectedCommitId: null });
                }
                setSelectMode(!selectMode);
              },
              selectMode,
            ),
            h(
              "span",
              {
                class: classNames(
                  "fig-devtools__badge",
                  snapshot.live && "is-live",
                ),
              },
              snapshot.live ? "Live" : "Snapshot",
            ),
            snapshot.live
              ? null
              : button("Resume", () => {
                  setSelection({ ...selection, selectedCommitId: null });
                }),
            button("Hide", () => setOpen(false)),
          ),
        )
      : h(
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
        ),
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

function useInspectMode(
  hook: FigDevtoolsHook,
  selectMode: boolean,
  setSelection: (selection: Selection) => void,
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
        setSelection({
          selectedCommitId: null,
          selectedFiberId: hover.fiberId,
          selectedRootId: hover.rootId,
          tab: "inspect",
        });
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
  setSelection: (selection: Selection) => void,
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
  setSelection: (selection: Selection) => void,
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
          setSelection({
            ...selection,
            selectedCommitId: null,
            selectedRootId,
            selectedFiberId:
              snapshot.roots.find((root) => root.id === selectedRootId)?.tree
                .id ?? null,
          });
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
  setSelection: (selection: Selection) => void,
): FigNode {
  const rootCommits = commitsForRoot(snapshot);

  if (rootCommits.length === 0) {
    return h("p", { class: "fig-devtools__empty" }, "No commits recorded.");
  }

  return h(
    "ol",
    { class: "fig-devtools__commit-list" },
    rootCommits.map((commit, index) =>
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
                setSelection({
                  ...selection,
                  selectedCommitId: commit.id,
                  selectedRootId: commit.rootId,
                  selectedFiberId: commit.tree.id,
                }),
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
  setSelection: (selection: Selection) => void,
  commitsOpen: boolean,
  setCommitsOpen: (commitsOpen: boolean) => void,
): FigNode {
  const rootCommits = commitsForRoot(snapshot);

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
          String(rootCommits.length),
        ),
      ),
      commitsOpen
        ? button("Clear", () => {
            hook.clear();
            setSelection({ ...selection, selectedCommitId: null });
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

function commitsForRoot(snapshot: RenderSnapshot): FigDevtoolsCommitSnapshot[] {
  if (snapshot.root === null) return [];

  return snapshot.commits.filter(
    (commit) => commit.rootId === snapshot.root?.id,
  );
}

function treePane(
  snapshot: RenderSnapshot,
  selection: Selection,
  setSelection: (selection: Selection) => void,
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
  setSelection: (selection: Selection) => void,
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
          on("click", () =>
            setSelection({ ...selection, selectedFiberId: fiber.id }),
          ),
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
  setSelection: (selection: Selection) => void,
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
    detailTab(selection.tab, fiber),
  );
}

function tabBar(
  selection: Selection,
  setSelection: (selection: Selection) => void,
): FigNode {
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
          events: [on("click", () => setSelection({ ...selection, tab }))],
        },
        tabLabel(tab),
      ),
    ),
  );
}

function detailTab(tab: DetailTab, fiber: FigDevtoolsFiberSnapshot): FigNode {
  if (tab === "props") return recordSection("Props", fiber.props);
  if (tab === "hooks") return hooksSection(fiber.hooks);
  if (tab === "context")
    return listSection("Context reads", fiber.contextDependencies);

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

  return {
    commits,
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
  return "Context";
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

const DevtoolsStyle = `
.fig-devtools {
  --fig-devtools-panel: #f7f8fb;
  --fig-devtools-surface: #ffffff;
  --fig-devtools-ink: #18181b;
  --fig-devtools-muted: #71717a;
  --fig-devtools-line: #d9dee8;
  --fig-devtools-accent: #2563eb;
  --fig-devtools-good: #059669;
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483647;
  width: min(920px, calc(100vw - 28px));
  height: min(620px, calc(100vh - 28px));
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  border: 1px solid #252936;
  border-radius: 8px;
  background: var(--fig-devtools-panel);
  color: var(--fig-devtools-ink);
  box-shadow: 0 22px 54px rgba(22, 24, 33, 0.28);
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
.fig-devtools[data-position="BottomLeft"] {
  right: auto;
  left: 14px;
}
.fig-devtools[data-position="TopRight"] {
  top: 14px;
  bottom: auto;
}
.fig-devtools[data-position="TopLeft"] {
  top: 14px;
  right: auto;
  bottom: auto;
  left: 14px;
}
.fig-devtools.is-panel {
  position: static;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fig-devtools.is-sidebar {
  position: static;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fig-devtools.is-sidebar.is-closed {
  position: fixed;
  right: 0;
  bottom: 28px;
  width: 44px;
  height: 112px;
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.fig-devtools.is-closed:not(.is-sidebar) {
  width: auto;
  height: auto;
  grid-template-rows: auto;
}
.fig-devtools button,
.fig-devtools select {
  font: inherit;
}
.fig-devtools__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px;
  border-bottom: 1px solid #252936;
  background: #171923;
  color: #f8fafc;
}
.fig-devtools__tab {
  width: 38px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid #3f475a;
  border-radius: 6px;
  background: #f8fafc;
  color: #111827;
  cursor: pointer;
  padding: 0;
}
.fig-devtools__mark {
  font-weight: 700;
  font-size: 11px;
}
.fig-devtools__collapsed-tab {
  width: 44px;
  height: 112px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  border: 1px solid #3f475a;
  border-right: 0;
  border-radius: 10px 0 0 10px;
  background: #252b3a;
  color: #d8def4;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.28);
  cursor: pointer;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  padding: 0;
}
.fig-devtools__collapsed-tab:hover {
  background: #1d2534;
}
.fig-devtools__heading {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.fig-devtools__title {
  font-size: 13px;
}
.fig-devtools__subtitle {
  min-width: 0;
  overflow: hidden;
  color: #cbd5e1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.fig-devtools__badge {
  min-width: 58px;
  border: 1px solid #475569;
  border-radius: 999px;
  padding: 3px 8px;
  color: #dbe3ef;
  text-align: center;
}
.fig-devtools__badge.is-live {
  border-color: rgba(5, 150, 105, 0.5);
  color: #a7f3d0;
}
.fig-devtools__button {
  border: 1px solid #c9d1df;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  padding: 4px 8px;
}
.fig-devtools__button.is-active {
  border-color: var(--fig-devtools-accent);
  background: #dbeafe;
  color: #1d4ed8;
}
.fig-devtools__header .fig-devtools__button {
  border-color: #475569;
  background: #252b3a;
  color: #ffffff;
}
.fig-devtools__header .fig-devtools__button.is-active {
  border-color: #93c5fd;
  background: #1d4ed8;
  color: #ffffff;
}
.fig-devtools__body {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}
.fig-devtools__history,
.fig-devtools__tree-pane,
.fig-devtools__details-pane {
  min-width: 0;
  overflow: auto;
}
.fig-devtools__history {
  overflow: hidden;
  border-top: 1px solid var(--fig-devtools-line);
  background: #eef1f6;
  padding: 0;
}
.fig-devtools__banner {
  margin: 10px 10px 0;
  border: 1px solid #b8c2d2;
  border-radius: 6px;
  background: #ffffff;
  color: #334155;
  padding: 8px;
}
.fig-devtools__banner.is-selecting {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1e3a8a;
}
.fig-devtools__root-select {
  width: 100%;
  min-height: 30px;
  margin-bottom: 10px;
}
.fig-devtools__commit-history {
  display: grid;
}
.fig-devtools__history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 38px;
  padding: 6px 10px;
  color: #334155;
  font-weight: 650;
}
.fig-devtools__history-head .fig-devtools__button {
  padding: 3px 7px;
}
.fig-devtools__history-toggle {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #334155;
  cursor: pointer;
  font-weight: 650;
  padding: 3px 0;
}
.fig-devtools__chevron {
  width: 14px;
  display: inline-block;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  transform: rotate(0deg);
}
.fig-devtools__chevron.is-open {
  transform: rotate(90deg);
}
.fig-devtools__commit-count {
  min-width: 22px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  color: #64748b;
  font-size: 11px;
  line-height: 1.2;
  padding: 1px 6px;
  text-align: center;
}
.fig-devtools__history-body {
  max-height: 178px;
  overflow: auto;
  border-top: 1px solid #dfe5ef;
  padding: 10px;
}
.fig-devtools.is-sidebar .fig-devtools__history-body {
  max-height: 160px;
}
.fig-devtools__commit-list {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.fig-devtools__commit {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 8px;
  border: 1px solid #d3d9e5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
  padding: 7px;
  text-align: left;
}
.fig-devtools__commit:hover {
  border-color: #9fb0ca;
}
.fig-devtools__commit.is-selected {
  border-color: var(--fig-devtools-accent);
  box-shadow: inset 3px 0 0 var(--fig-devtools-accent);
}
.fig-devtools__commit-id {
  font-weight: 700;
}
.fig-devtools__commit-meta,
.fig-devtools__commit-time {
  color: var(--fig-devtools-muted);
}
.fig-devtools__commit-time {
  grid-column: 2;
}
.fig-devtools__main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(320px, 1.15fr);
}
.fig-devtools.is-sidebar .fig-devtools__main {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(180px, 0.8fr) minmax(240px, 1fr);
}
.fig-devtools__tree-pane {
  border-right: 1px solid var(--fig-devtools-line);
  background: var(--fig-devtools-surface);
}
.fig-devtools.is-sidebar .fig-devtools__tree-pane {
  border-right: 0;
  border-bottom: 1px solid var(--fig-devtools-line);
}
.fig-devtools__details-pane {
  background: var(--fig-devtools-panel);
  padding: 14px;
}
.fig-devtools__tree {
  padding: 8px 0;
}
.fig-devtools__tree-button {
  width: 100%;
  min-height: 28px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #17202a;
  cursor: pointer;
  padding: 5px 8px;
  text-align: left;
}
.fig-devtools__tree-button:hover {
  background: #eef2f7;
}
.fig-devtools__tree-button.is-selected {
  background: #dbeafe;
  color: #1d4ed8;
}
.fig-devtools__kind {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #64748b;
}
.fig-devtools__kind.is-function {
  background: #2563eb;
}
.fig-devtools__kind.is-host,
.fig-devtools__kind.is-text {
  background: #059669;
}
.fig-devtools__kind.is-suspense,
.fig-devtools__kind.is-error-boundary,
.fig-devtools__kind.is-activity {
  background: #b45309;
}
.fig-devtools__tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__hook-count {
  min-width: 22px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  font-size: 11px;
  padding: 1px 6px;
  text-align: center;
}
.fig-devtools__details {
  display: grid;
  gap: 12px;
}
.fig-devtools__details-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fig-devtools__name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 16px;
}
.fig-devtools__chip {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #475569;
  padding: 2px 8px;
}
.fig-devtools__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--fig-devtools-line);
}
.fig-devtools__tab-button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #475569;
  cursor: pointer;
  padding: 6px 8px;
}
.fig-devtools__tab-button.is-selected {
  border-bottom-color: var(--fig-devtools-accent);
  color: #1d4ed8;
}
.fig-devtools__section {
  margin-top: 12px;
}
.fig-devtools__section-title {
  margin: 0 0 6px;
  color: #475569;
  font-size: 11px;
  text-transform: uppercase;
}
.fig-devtools__row {
  display: grid;
  grid-template-columns: minmax(76px, 0.32fr) minmax(0, 1fr);
  gap: 8px;
  padding: 4px 0;
}
.fig-devtools__row-label {
  min-width: 0;
  color: var(--fig-devtools-muted);
  overflow-wrap: anywhere;
}
.fig-devtools__row-value {
  min-width: 0;
  color: #111827;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.fig-devtools__html {
  margin: 0;
  overflow: auto;
  border: 1px solid #d7deea;
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  padding: 8px;
  white-space: pre-wrap;
}
.fig-devtools__empty {
  margin: 0;
  color: var(--fig-devtools-muted);
}
.fig-devtools__inspect-overlay {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border: 2px solid var(--fig-devtools-accent);
  background: rgba(37, 99, 235, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.82);
}
.fig-devtools__inspect-label {
  position: absolute;
  max-width: min(360px, calc(100vw - 20px));
  overflow: hidden;
  border-radius: 5px;
  background: #1d4ed8;
  color: #ffffff;
  font-weight: 650;
  padding: 4px 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .fig-devtools {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
  }
  .fig-devtools__main {
    grid-template-columns: 1fr;
  }
  .fig-devtools__tree-pane {
    max-height: 180px;
    border-right: 0;
    border-bottom: 1px solid var(--fig-devtools-line);
  }
  .fig-devtools__history-body {
    max-height: 150px;
  }
}
`;
