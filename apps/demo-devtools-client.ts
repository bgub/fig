// Client half of the demos' shared DevTools wiring (the server half is
// demo-devtools-prerender.ts). One cookie drives the panel state in every
// demo so the server can render the true open/closed state directly.
// createElement instead of JSX: this file sits above the per-app tsconfigs
// that configure the fig JSX runtime.
import {
  createElement,
  type FigNode,
  useMemo,
  useSyncExternalStore,
} from "@bgub/fig";
import { hydrateRoot } from "@bgub/fig-dom";
import {
  FigDevtools,
  type FigDevtoolsHook,
  type FigDevtoolsRootSnapshot,
} from "@bgub/fig-devtools";

export const devtoolsOpenCookie = "fig-demo-devtools-open";

// The server inlines the exact snapshot it prerendered the panel from under
// this id so the client can hydrate the panel against identical data.
export const devtoolsSnapshotScriptId = "fig-demo-devtools-snapshot";

export function readDevtoolsOpen(cookies: string): boolean {
  return !cookies
    .split(";")
    .some((entry) => entry.trim() === `${devtoolsOpenCookie}=false`);
}

export function storeDevtoolsOpen(open: boolean): void {
  document.cookie = `${devtoolsOpenCookie}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}

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
  };
}

// The shell streams the panel prerendered from the server's tree, and the
// server inlines that same snapshot as JSON; hydrating against it adopts the
// streamed markup, so the panel is interactive from hydration instead of the
// first commit. DevtoolsPanel then swaps the data source to the live hook in
// place — no remount, so open/closed and selection state carry over.
export function hydrateDevtoolsPanel(
  container: HTMLElement,
  hook: FigDevtoolsHook,
): void {
  const hydrate = () => {
    const script = document.getElementById(devtoolsSnapshotScriptId);
    const json = script?.textContent ?? "";
    if (json === "") {
      throw new Error("Missing prerendered devtools snapshot.");
    }
    hydrateRoot(
      container,
      createElement(DevtoolsPanel, {
        liveHook: hook,
        snapshotRoot: JSON.parse(json) as FigDevtoolsRootSnapshot,
      }),
      { devtools: false },
    );
  };

  // The snapshot script streams after the aside; during streaming this
  // module can execute before either finishes parsing, so wait for the
  // document before reading and adopting that markup.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
}

function DevtoolsPanel(props: {
  liveHook: FigDevtoolsHook;
  snapshotRoot: FigDevtoolsRootSnapshot;
}): FigNode {
  const { liveHook, snapshotRoot } = props;
  const snapshotHook = useMemo(
    () => snapshotDevtoolsHook(snapshotRoot),
    [snapshotRoot],
  );
  const subscribe = useMemo(
    () => liveHook.subscribe.bind(liveHook),
    [liveHook],
  );
  const getSnapshot = useMemo(
    () => () => liveHook.commits.length > 0,
    [liveHook],
  );
  // Server snapshot is false: the hydration render must use the snapshot
  // hook to match the prerendered markup even if the app committed first.
  const hasLiveData = useSyncExternalStore(subscribe, getSnapshot, () => false);

  return createElement(FigDevtools, {
    defaultOpen: readDevtoolsOpen(document.cookie),
    hook: hasLiveData ? liveHook : snapshotHook,
    onOpenChange: storeDevtoolsOpen,
    placement: "sidebar",
  });
}
