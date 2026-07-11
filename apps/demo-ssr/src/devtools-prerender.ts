// Converts fig-server's collected render tree into a Fig DevTools snapshot
// and serves it through a read-only hook. The hook materializes lazily: the
// DevTools aside renders after the app pane in document order, so by the
// time the panel reads it the collector already holds the app's tree. Hooks,
// lanes, and fiber ids are client-runtime facts the server cannot know; the
// client replaces this panel with the live one after the first real commit.
import type { FigDevtoolsHook } from "@bgub/fig-devtools";
import type { RenderTreeCollector, RenderTreeNode } from "@bgub/fig-server";
import type {
  FigDevtoolsFiberSnapshot,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler/devtools";

export function prerenderedDevtoolsHook(
  collector: RenderTreeCollector,
  appRootId: string,
): FigDevtoolsHook {
  let seeded: FigDevtoolsRootSnapshot | null = null;
  const snapshot = (): FigDevtoolsRootSnapshot =>
    (seeded ??= buildSnapshot(collector.tree, appRootId));

  return {
    get renderers() {
      return new Map([
        [1, { name: "Fig", packageName: "@bgub/fig-reconciler" }],
      ]);
    },
    get roots() {
      return new Map([[1, snapshot()]]);
    },
    get commits() {
      const root = snapshot();
      return [
        {
          id: 1,
          rendererId: 1,
          rootId: 1,
          committedAt: root.committedAt,
          tree: root.tree,
          root,
        },
      ];
    },
    get revision() {
      return 1;
    },
    inject: () => 1,
    onCommitRoot: () => undefined,
    subscribe: () => () => undefined,
    clear: () => undefined,
    inspectElement: () => null,
  };
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
      props: node.props,
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
