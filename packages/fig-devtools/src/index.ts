import { createElement, type FigNode } from "@bgub/fig";
import { createRoot, flushSync } from "@bgub/fig-dom";
import {
  FigDevtools,
  type FigDevtoolsPlacement,
  type FigDevtoolsPosition,
} from "./component.ts";
import { ensureFigDevtoolsGlobalHook, type FigDevtoolsHook } from "./hook.ts";

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

export interface FigDevtoolsInstallOptions {
  target?: HTMLElement;
  open?: boolean;
  placement?: FigDevtoolsPlacement;
  position?: FigDevtoolsPosition;
  banner?: string;
}

export interface FigDevtoolsPanelOptions extends FigDevtoolsInstallOptions {
  hook: FigDevtoolsHook;
}

export interface FigDevtoolsController {
  hook: FigDevtoolsHook;
  show(): void;
  hide(): void;
  toggle(): void;
  uninstall(): void;
}

interface MountedPanel {
  root: ReturnType<typeof createRoot>;
  container: HTMLElement;
  open: boolean;
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

  const target = options.target ?? document.body ?? document.documentElement;
  const doc = target.ownerDocument;
  const container = doc.createElement("div");
  const mounted: MountedPanel = {
    container,
    open: options.open ?? true,
    root: createRoot(container, { devtools: false }),
  };

  target.appendChild(container);
  renderMountedPanel(mounted, options);

  return {
    hook: options.hook,
    show() {
      mounted.open = true;
      renderMountedPanel(mounted, options);
    },
    hide() {
      mounted.open = false;
      renderMountedPanel(mounted, options);
    },
    toggle() {
      mounted.open = !mounted.open;
      renderMountedPanel(mounted, options);
    },
    uninstall() {
      mounted.root.unmount();
      mounted.container.remove();
    },
  };
}

function renderMountedPanel(
  mounted: MountedPanel,
  options: FigDevtoolsPanelOptions,
): void {
  flushSync(() =>
    mounted.root.render(
      createElement(FigDevtools, {
        banner: options.banner,
        hook: options.hook,
        open: mounted.open,
        placement: options.placement,
        position: options.position,
        onOpenChange: (open: boolean) => {
          mounted.open = open;
          renderMountedPanel(mounted, options);
        },
      }),
    ),
  );
}

export type { FigNode };
