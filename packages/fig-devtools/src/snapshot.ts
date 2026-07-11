// Shared, DOM-free core of the SSR DevTools wiring used by both the server
// (@bgub/fig-devtools/server) and client (@bgub/fig-devtools/client) halves.
// One prerendered commit drives the panel; the server builds it from a
// render-tree collector, the client hydrates the streamed panel against the
// same snapshot inlined as JSON, then swaps to the live hook.
import type { FigDevtoolsRootSnapshot } from "@bgub/fig-reconciler/devtools";
import type { FigDevtoolsHook } from "./hook.ts";

// The server inlines the exact snapshot it prerendered the panel from under
// this id so the client can hydrate the panel against identical data.
export const devtoolsSnapshotScriptId = "fig-devtools-snapshot";

// Read-only hook over a single prerendered commit. Both halves render the
// panel through this wrapper — the server from the collector's tree, the
// client from the inlined JSON — so hydration sees identical data.
export function snapshotDevtoolsHook(
  root: FigDevtoolsRootSnapshot,
): FigDevtoolsHook {
  return {
    commits: [
      {
        id: 1,
        rendererId: 1,
        rootId: 1,
        committedAt: root.committedAt,
        tree: root.tree,
        root,
      },
    ],
    renderers: new Map([
      [1, { name: "Fig", packageName: "@bgub/fig-reconciler" }],
    ]),
    roots: new Map([[1, root]]),
    revision: 1,
    inject: () => 1,
    onCommitRoot: () => undefined,
    subscribe: () => () => undefined,
    clear: () => undefined,
    inspectElement: () => null,
    elementForFiber: () => null,
  };
}
