import type { FigNode } from "@bgub/fig";

// Types that appear in this package's public signatures (FigDevtoolsHook,
// FigDevtoolsCommitSnapshot) — re-exported so consumers never reach into the
// reconciler subpath.
export type {
  FigDevtoolsCommitInspection,
  FigDevtoolsElementInspection,
  FigDevtoolsFiberSnapshot,
  FigDevtoolsGlobalHook,
  FigDevtoolsHookSnapshot,
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler/devtools";
export {
  FigDevtools,
  type FigDevtoolsPlacement,
  type FigDevtoolsPosition,
  type FigDevtoolsProps,
  type FigDevtoolsTheme,
} from "./component.ts";
export {
  createFigDevtoolsGlobalHook,
  ensureFigDevtoolsGlobalHook,
  FIG_DEVTOOLS_HOOK_KEY,
  type FigDevtoolsCommitSnapshot,
  type FigDevtoolsGlobalTarget,
  type FigDevtoolsHook,
  type FigDevtoolsHookOptions,
  type FigDevtoolsListener,
} from "./hook.ts";
export {
  installFigDevtools,
  mountFigDevtoolsPanel,
  type FigDevtoolsController,
  type FigDevtoolsInstallOptions,
  type FigDevtoolsPanelOptions,
  type FigDevtoolsPanelUpdate,
} from "./panel.ts";

export type { FigNode };
