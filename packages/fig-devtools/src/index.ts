import type {
  FigDevtoolsFiberSnapshot,
  FigDevtoolsGlobalHook,
  FigDevtoolsHookSnapshot,
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";

export const FIG_DEVTOOLS_HOOK_KEY = "__FIG_DEVTOOLS_GLOBAL_HOOK__";

export interface FigDevtoolsHook extends FigDevtoolsGlobalHook {
  renderers: Map<number, FigDevtoolsRendererInfo>;
  roots: Map<number, FigDevtoolsRootSnapshot>;
  subscribe(listener: FigDevtoolsListener): () => void;
}

export type FigDevtoolsListener = () => void;

export interface FigDevtoolsInstallOptions {
  target?: HTMLElement;
  open?: boolean;
  placement?: FigDevtoolsPlacement;
}

export type FigDevtoolsPlacement = "overlay" | "panel";

export interface FigDevtoolsPanelOptions {
  hook: FigDevtoolsHook;
  target?: HTMLElement;
  open?: boolean;
  placement?: FigDevtoolsPlacement;
}

export interface FigDevtoolsController {
  hook: FigDevtoolsHook;
  show(): void;
  hide(): void;
  toggle(): void;
  uninstall(): void;
}

type FigDevtoolsGlobalTarget = typeof globalThis & {
  [FIG_DEVTOOLS_HOOK_KEY]?: unknown;
};

interface PanelState {
  open: boolean;
  selectedRootId: number | null;
  selectedFiberId: number | null;
}

interface RenderContext {
  doc: Document;
  panel: HTMLElement;
  hook: FigDevtoolsHook;
  state: PanelState;
  rerender(): void;
}

export function createFigDevtoolsGlobalHook(): FigDevtoolsHook {
  const renderers = new Map<number, FigDevtoolsRendererInfo>();
  const roots = new Map<number, FigDevtoolsRootSnapshot>();
  const listeners = new Set<FigDevtoolsListener>();
  let nextRendererId = 1;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    renderers,
    roots,
    inject(renderer) {
      const id = nextRendererId;
      nextRendererId += 1;
      renderers.set(id, renderer);
      notify();
      return id;
    },
    onCommitRoot(_rendererId, snapshot) {
      roots.set(snapshot.id, snapshot);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function ensureFigDevtoolsGlobalHook(
  target: FigDevtoolsGlobalTarget = globalThis,
): FigDevtoolsHook {
  const current = target[FIG_DEVTOOLS_HOOK_KEY];
  if (isFigDevtoolsHook(current)) return current;

  const hook = createFigDevtoolsGlobalHook();
  target[FIG_DEVTOOLS_HOOK_KEY] = hook;
  return hook;
}

export function installFigDevtools(
  options: FigDevtoolsInstallOptions = {},
): FigDevtoolsController {
  return mountFigDevtoolsPanel({
    ...options,
    hook: ensureFigDevtoolsGlobalHook(),
  });
}

export function mountFigDevtoolsPanel(
  options: FigDevtoolsPanelOptions,
): FigDevtoolsController {
  if (typeof document === "undefined") {
    throw new Error(
      "Fig DevTools can only be installed in a browser document.",
    );
  }

  const hook = options.hook;
  const target = options.target ?? document.body ?? document.documentElement;
  const doc = target.ownerDocument;
  const state: PanelState = {
    open: options.open ?? true,
    selectedRootId: null,
    selectedFiberId: null,
  };

  installStyle(doc);

  const panel = doc.createElement("section");
  panel.className = "fig-devtools";
  panel.classList.toggle("is-panel", options.placement === "panel");
  panel.setAttribute("aria-label", "Fig DevTools");
  target.appendChild(panel);

  const context: RenderContext = {
    doc,
    panel,
    hook,
    state,
    rerender() {
      renderPanel(context);
    },
  };
  const unsubscribe = hook.subscribe(context.rerender);
  context.rerender();

  return {
    hook,
    show() {
      state.open = true;
      context.rerender();
    },
    hide() {
      state.open = false;
      context.rerender();
    },
    toggle() {
      state.open = !state.open;
      context.rerender();
    },
    uninstall() {
      unsubscribe();
      panel.remove();
    },
  };
}

function renderPanel(context: RenderContext): void {
  const { doc, hook, panel, state } = context;
  panel.replaceChildren();
  panel.classList.toggle("is-closed", !state.open);

  const roots = [...hook.roots.values()].sort(
    (left, right) => left.committedAt - right.committedAt,
  );
  const root = selectRoot(roots, state);

  const header = el(doc, "div", "fig-devtools__header");
  header.append(
    el(doc, "strong", "fig-devtools__title", "Fig DevTools"),
    el(doc, "span", "fig-devtools__status", rootStatus(root)),
    button(doc, state.open ? "Hide" : "Show", () => {
      state.open = !state.open;
      context.rerender();
    }),
  );
  panel.append(header);

  if (!state.open) return;

  const body = el(doc, "div", "fig-devtools__body");
  const treePane = el(doc, "div", "fig-devtools__tree-pane");
  const detailsPane = el(doc, "div", "fig-devtools__details-pane");

  if (roots.length > 1) {
    treePane.append(rootSelector(context, roots));
  }

  if (root === null) {
    treePane.append(el(doc, "p", "fig-devtools__empty", "No Fig roots yet."));
    detailsPane.append(
      el(doc, "p", "fig-devtools__empty", "Render a Fig root to inspect it."),
    );
  } else {
    treePane.append(fiberTree(context, root.tree, 0));
    detailsPane.append(
      fiberDetails(
        doc,
        findFiber(root.tree, state.selectedFiberId) ?? root.tree,
      ),
    );
  }

  body.append(treePane, detailsPane);
  panel.append(body);
}

function selectRoot(
  roots: FigDevtoolsRootSnapshot[],
  state: PanelState,
): FigDevtoolsRootSnapshot | null {
  const latestRoot = roots.at(-1) ?? null;
  const selectedRoot =
    roots.find((candidate) => candidate.id === state.selectedRootId) ??
    latestRoot;

  state.selectedRootId = selectedRoot?.id ?? null;

  if (
    selectedRoot !== null &&
    (state.selectedFiberId === null ||
      findFiber(selectedRoot.tree, state.selectedFiberId) === null)
  ) {
    state.selectedFiberId = selectedRoot.tree.id;
  } else if (selectedRoot === null) {
    state.selectedFiberId = null;
  }

  return selectedRoot;
}

function rootStatus(root: FigDevtoolsRootSnapshot | null): string {
  if (root === null) return "Waiting for a commit";

  const count = root.tree.children.length;
  return `Root ${root.id} - ${count} child ${count === 1 ? "node" : "nodes"}`;
}

function rootSelector(
  context: RenderContext,
  roots: FigDevtoolsRootSnapshot[],
): HTMLSelectElement {
  const { doc, state } = context;
  const select = doc.createElement("select");
  select.className = "fig-devtools__root-select";

  for (const root of roots) {
    const option = doc.createElement("option");
    option.value = String(root.id);
    option.textContent = `Root ${root.id}`;
    option.selected = root.id === state.selectedRootId;
    select.append(option);
  }

  select.addEventListener("change", () => {
    state.selectedRootId = Number(select.value);
    state.selectedFiberId =
      roots.find((root) => root.id === state.selectedRootId)?.tree.id ?? null;
    context.rerender();
  });

  return select;
}

function fiberTree(
  context: RenderContext,
  fiber: FigDevtoolsFiberSnapshot,
  depth: number,
): HTMLElement {
  const { doc, state } = context;
  const wrapper = el(doc, "div", "fig-devtools__tree-node");
  const item = button(doc, treeLabel(fiber), () => {
    state.selectedFiberId = fiber.id;
    context.rerender();
  });
  item.classList.add("fig-devtools__tree-button");
  item.classList.toggle("is-selected", fiber.id === state.selectedFiberId);
  item.style.paddingLeft = `${8 + depth * 14}px`;
  wrapper.append(item);

  for (const child of fiber.children) {
    wrapper.append(fiberTree(context, child, depth + 1));
  }

  return wrapper;
}

function fiberDetails(
  doc: Document,
  fiber: FigDevtoolsFiberSnapshot,
): HTMLElement {
  const details = el(doc, "div", "fig-devtools__details");
  details.append(
    el(doc, "h2", "fig-devtools__name", fiber.name),
    row(doc, "Kind", fiber.kind),
    row(doc, "Key", fiber.key === null ? "none" : String(fiber.key)),
    row(doc, "Fiber id", String(fiber.id)),
    row(doc, "Lanes", `${fiber.lanes} / child ${fiber.childLanes}`),
  );

  if (fiber.capturedError !== undefined) {
    details.append(
      row(doc, "Captured error", formatValue(fiber.capturedError)),
      row(doc, "Component stack", fiber.componentStack?.trim() ?? ""),
    );
  }

  details.append(
    recordSection(doc, "Props", fiber.props),
    hooksSection(doc, fiber),
    listSection(doc, "Context reads", fiber.contextDependencies),
  );

  return details;
}

function recordSection(
  doc: Document,
  title: string,
  record: Record<string, unknown>,
): HTMLElement {
  const section = el(doc, "section", "fig-devtools__section");
  section.append(el(doc, "h3", "fig-devtools__section-title", title));
  const entries = Object.entries(record);

  if (entries.length === 0) {
    section.append(el(doc, "p", "fig-devtools__empty", "None"));
    return section;
  }

  for (const [key, value] of entries) {
    section.append(row(doc, key, formatValue(value)));
  }

  return section;
}

function hooksSection(
  doc: Document,
  fiber: FigDevtoolsFiberSnapshot,
): HTMLElement {
  const section = el(doc, "section", "fig-devtools__section");
  section.append(el(doc, "h3", "fig-devtools__section-title", "Hooks"));

  if (fiber.hooks.length === 0) {
    section.append(el(doc, "p", "fig-devtools__empty", "None"));
    return section;
  }

  for (const hook of fiber.hooks) {
    section.append(row(doc, `#${hook.id} ${hook.kind}`, hookValue(hook)));
  }

  return section;
}

function hookValue(hook: FigDevtoolsHookSnapshot): string {
  if (hook.kind === "state") return formatValue(hook.state);
  if (hook.kind === "memo") {
    return `${formatValue(hook.state)} deps ${formatValue(hook.deps)}`;
  }

  return `${hook.phase ?? hook.kind} deps ${formatValue(hook.deps)}${hook.active ? " active" : ""}`;
}

function listSection(
  doc: Document,
  title: string,
  items: string[],
): HTMLElement {
  const section = el(doc, "section", "fig-devtools__section");
  section.append(el(doc, "h3", "fig-devtools__section-title", title));

  if (items.length === 0) {
    section.append(el(doc, "p", "fig-devtools__empty", "None"));
    return section;
  }

  for (const item of items) section.append(row(doc, "", item));
  return section;
}

function row(doc: Document, label: string, value: string): HTMLElement {
  const element = el(doc, "div", "fig-devtools__row");
  element.append(
    el(doc, "span", "fig-devtools__row-label", label),
    el(doc, "code", "fig-devtools__row-value", value),
  );
  return element;
}

function findFiber(
  fiber: FigDevtoolsFiberSnapshot,
  id: number | null,
): FigDevtoolsFiberSnapshot | null {
  if (id === null) return null;
  if (fiber.id === id) return fiber;

  for (const child of fiber.children) {
    const found = findFiber(child, id);
    if (found !== null) return found;
  }

  return null;
}

function treeLabel(fiber: FigDevtoolsFiberSnapshot): string {
  const key = fiber.key === null ? "" : ` key=${String(fiber.key)}`;
  const count = fiber.hooks.length === 0 ? "" : ` (${fiber.hooks.length})`;
  return `${fiber.name}${key}${count}`;
}

function button(
  doc: Document,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const element = doc.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tagName);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
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
  if (typeof value !== "object") return String(value);

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

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function isFigDevtoolsHook(value: unknown): value is FigDevtoolsHook {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<FigDevtoolsHook>;
  return (
    candidate.renderers instanceof Map &&
    candidate.roots instanceof Map &&
    typeof candidate.inject === "function" &&
    typeof candidate.onCommitRoot === "function" &&
    typeof candidate.subscribe === "function"
  );
}

function installStyle(doc: Document): void {
  if (doc.getElementById("fig-devtools-style") !== null) return;

  const style = doc.createElement("style");
  style.id = "fig-devtools-style";
  style.textContent = `
.fig-devtools {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483647;
  width: min(720px, calc(100vw - 28px));
  height: min(520px, calc(100vh - 28px));
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  border: 1px solid #293241;
  border-radius: 8px;
  background: #f8fafc;
  color: #111827;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.fig-devtools.is-closed {
  width: 280px;
  height: auto;
}
.fig-devtools.is-panel {
  position: static;
  width: 100vw;
  height: 100vh;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fig-devtools.is-panel.is-closed {
  width: 100vw;
}
.fig-devtools button,
.fig-devtools select {
  font: inherit;
}
.fig-devtools__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 10px;
  border-bottom: 1px solid #d0d7de;
  background: #111827;
  color: #f9fafb;
}
.fig-devtools__header button {
  border: 1px solid #4b5563;
  border-radius: 6px;
  background: #243244;
  color: #ffffff;
  padding: 4px 8px;
}
.fig-devtools__title {
  font-size: 13px;
}
.fig-devtools__status {
  min-width: 0;
  overflow: hidden;
  color: #cbd5e1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(260px, 1.1fr);
}
.fig-devtools__tree-pane,
.fig-devtools__details-pane {
  min-width: 0;
  overflow: auto;
}
.fig-devtools__tree-pane {
  border-right: 1px solid #d0d7de;
  background: #ffffff;
  padding: 8px 0;
}
.fig-devtools__details-pane {
  padding: 12px;
}
.fig-devtools__root-select {
  width: calc(100% - 16px);
  margin: 0 8px 8px;
}
.fig-devtools__tree-button {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #17202a;
  display: block;
  overflow: hidden;
  padding: 5px 8px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fig-devtools__tree-button:hover {
  background: #eef2f7;
}
.fig-devtools__tree-button.is-selected {
  background: #dbeafe;
  color: #1d4ed8;
}
.fig-devtools__name {
  margin: 0 0 10px;
  font-size: 16px;
}
.fig-devtools__section {
  margin-top: 14px;
}
.fig-devtools__section-title {
  margin: 0 0 6px;
  color: #475569;
  font-size: 11px;
  text-transform: uppercase;
}
.fig-devtools__row {
  display: grid;
  grid-template-columns: minmax(74px, 0.34fr) minmax(0, 1fr);
  gap: 8px;
  padding: 4px 0;
}
.fig-devtools__row-label {
  min-width: 0;
  color: #64748b;
  overflow-wrap: anywhere;
}
.fig-devtools__row-value {
  min-width: 0;
  color: #0f172a;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.fig-devtools__empty {
  margin: 0;
  color: #64748b;
}
@media (max-width: 680px) {
  .fig-devtools {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
  }
  .fig-devtools__body {
    grid-template-columns: 1fr;
  }
  .fig-devtools__tree-pane {
    max-height: 190px;
    border-right: 0;
    border-bottom: 1px solid #d0d7de;
  }
}
`;
  doc.head.append(style);
}
