// Client half of the SSR DevTools wiring (the server half is server.ts). The
// shell streams the panel prerendered from the server's tree and inlines that
// same snapshot as JSON; hydrating against it adopts the streamed markup, so
// the panel is interactive from hydration instead of the first commit.
// DevtoolsPanel then swaps the data source to the live hook in place — no
// remount, so open/closed and selection state carry over.
import {
  createElement,
  type FigNode,
  useMemo,
  useSyncExternalStore,
} from "@bgub/fig";
import { hydrateRoot } from "@bgub/fig-dom";
import type { FigDevtoolsRootSnapshot } from "@bgub/fig-reconciler/devtools";
import { FigDevtools, type FigDevtoolsPlacement } from "./component.ts";
import type { FigDevtoolsHook } from "./hook.ts";
import { devtoolsSnapshotScriptId, snapshotDevtoolsHook } from "./snapshot.ts";

export { devtoolsSnapshotScriptId, snapshotDevtoolsHook } from "./snapshot.ts";

export interface HydrateDevtoolsPanelOptions {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: FigDevtoolsPlacement;
}

export function hydrateDevtoolsPanel(
  container: HTMLElement,
  hook: FigDevtoolsHook,
  options: HydrateDevtoolsPanelOptions = {},
): void {
  // The consumer emits the snapshot script before the client entry, so by the
  // time this runs the panel markup and JSON are already complete.
  const script = document.getElementById(devtoolsSnapshotScriptId);
  const json = script?.textContent ?? "";
  if (json === "") {
    throw new Error("Missing prerendered devtools snapshot.");
  }
  hydrateRoot(
    container,
    createElement(DevtoolsPanel, {
      liveHook: hook,
      options,
      snapshotRoot: JSON.parse(json) as FigDevtoolsRootSnapshot,
    }),
    { devtools: false },
  );
}

function DevtoolsPanel(props: {
  liveHook: FigDevtoolsHook;
  options: HydrateDevtoolsPanelOptions;
  snapshotRoot: FigDevtoolsRootSnapshot;
}): FigNode {
  const { liveHook, options, snapshotRoot } = props;
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
  // Server snapshot is false: the hydration render must use the snapshot hook
  // to match the prerendered markup even if the app committed first.
  const hasLiveData = useSyncExternalStore(subscribe, getSnapshot, () => false);

  return createElement(FigDevtools, {
    defaultOpen: options.defaultOpen ?? true,
    hook: hasLiveData ? liveHook : snapshotHook,
    onOpenChange: options.onOpenChange,
    placement: options.placement ?? "sidebar",
  });
}
