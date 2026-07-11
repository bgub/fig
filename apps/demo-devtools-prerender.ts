// Server half of the demos' shared DevTools wiring: converts fig-server's
// collected render tree into a Fig DevTools snapshot, serves it to the panel
// through a read-only hook, and inlines the same snapshot as JSON so the
// client can hydrate the streamed panel instead of replacing it. The
// snapshot materializes lazily — the DevTools aside renders after the app
// pane in document order, so by the time the panel reads the hook the
// collector already holds the app's tree. Hooks, lanes, and fiber ids are
// client-runtime facts the server cannot know; the hydrated panel swaps to
// the live hook after the first real commit (demo-devtools-client.ts).
import { createElement, type FigNode } from "@bgub/fig";
import type {
  FigDevtoolsFiberSnapshot,
  FigDevtoolsHook,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-devtools";
import type { RenderTreeCollector, RenderTreeNode } from "@bgub/fig-server";
import {
  devtoolsOpenCookie,
  devtoolsSnapshotScriptId,
  snapshotDevtoolsHook,
} from "./demo-devtools-client.ts";

export function devtoolsOpenFromCookieHeader(
  header: string | string[] | undefined,
): boolean {
  const cookies = (Array.isArray(header) ? header[0] : header) ?? "";
  return !cookies
    .split(";")
    .some((entry) => entry.trim() === `${devtoolsOpenCookie}=false`);
}

export interface PrerenderedDevtools {
  hook: FigDevtoolsHook;
  snapshot(): FigDevtoolsRootSnapshot;
}

export function prerenderedDevtools(
  collector: RenderTreeCollector,
  appRootId: string,
): PrerenderedDevtools {
  let seededRoot: FigDevtoolsRootSnapshot | null = null;
  let seededHook: FigDevtoolsHook | null = null;
  const snapshot = () =>
    (seededRoot ??= buildSnapshot(collector.tree, appRootId));
  const materialize = () => (seededHook ??= snapshotDevtoolsHook(snapshot()));

  return {
    hook: {
      get renderers() {
        return materialize().renderers;
      },
      get roots() {
        return materialize().roots;
      },
      get commits() {
        return materialize().commits;
      },
      get revision() {
        return 1;
      },
      inject: () => 1,
      onCommitRoot: () => undefined,
      subscribe: () => () => undefined,
      clear: () => undefined,
      inspectElement: () => null,
    },
    snapshot,
  };
}

/**
 * Inlines the snapshot the panel prerendered from, for client hydration.
 * Render it after the DevTools aside in document order: the first snapshot
 * read caches, so panel markup and inlined JSON come from the same data.
 */
export function DevtoolsSnapshotScript(props: {
  devtools: PrerenderedDevtools;
}): FigNode {
  return createElement("script", {
    id: devtoolsSnapshotScriptId,
    type: "application/json",
    unsafeHTML: JSON.stringify(props.devtools.snapshot()).replace(
      /</g,
      "\\u003C",
    ),
  });
}

function buildSnapshot(
  tree: RenderTreeNode,
  appRootId: string,
): FigDevtoolsRootSnapshot {
  let nextId = 2;
  const convert = (
    node: RenderTreeNode,
    parentId: number,
    index: number,
  ): FigDevtoolsFiberSnapshot => {
    const id = nextId++;
    return {
      id,
      parentId,
      name: node.name,
      kind: node.kind === "client-reference" ? "function" : node.kind,
      key: node.key,
      index,
      props: displayProps(node.props),
      pendingWork: [],
      childWork: [],
      hooks: [],
      contextDependencies: [],
      children: node.children.map((child, childIndex) =>
        convert(child, id, childIndex),
      ),
    };
  };

  // The document render collects everything, the aside included; the panel
  // shows the app's subtree.
  const appRoot = findByElementId(tree, appRootId) ?? tree;
  return {
    id: 1,
    rendererId: 1,
    committedAt: 0,
    dataResources: [],
    pendingWork: [],
    suspendedWork: [],
    pingedWork: [],
    expiredWork: [],
    tree: {
      id: 1,
      parentId: null,
      name: "Root",
      kind: "root",
      key: null,
      index: 0,
      props: {},
      pendingWork: [],
      childWork: [],
      hooks: [],
      contextDependencies: [],
      children: appRoot.children.map((child, index) =>
        convert(child, 1, index),
      ),
    },
  };
}

// The snapshot must survive JSON (the client hydrates from the inlined
// copy), so non-JSON prop values reduce to short display strings. Lossy is
// fine: the panel paints prop values only in detail tabs, and the live hook
// replaces the snapshot after the first client commit.
function displayProps(props: Record<string, unknown>): Record<string, unknown> {
  const display: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    display[name] = displayValue(value, 0);
  }
  return display;
}

function displayValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "function") {
    return `ƒ ${value.name === "" ? "anonymous" : value.name}()`;
  }
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (depth >= 2)
      return Array.isArray(value) ? `Array(${value.length})` : "{…}";
    if (Array.isArray(value)) {
      return value.map((item) => displayValue(item, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const display: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(value)) {
        display[name] = displayValue(item, depth + 1);
      }
      return display;
    }
    return `[${value.constructor?.name ?? "object"}]`;
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  return "undefined";
}

function findByElementId(
  node: RenderTreeNode,
  elementId: string,
): RenderTreeNode | null {
  if (node.kind === "host" && node.props.id === elementId) return node;
  for (const child of node.children) {
    const found = findByElementId(child, elementId);
    if (found !== null) return found;
  }
  return null;
}
