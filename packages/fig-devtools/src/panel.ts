import { createElement } from "@bgub/fig";
import { createRoot, flushSync } from "@bgub/fig-dom";
import {
  FigDevtools,
  type FigDevtoolsPlacement,
  type FigDevtoolsPosition,
  type FigDevtoolsTheme,
} from "./component.ts";
import { ensureFigDevtoolsGlobalHook, type FigDevtoolsHook } from "./hook.ts";

export interface FigDevtoolsInstallOptions {
  collapsible?: boolean;
  target?: HTMLElement;
  open?: boolean;
  overlayTarget?: Element;
  overlayZIndex?: number;
  placement?: FigDevtoolsPlacement;
  position?: FigDevtoolsPosition;
  theme?: FigDevtoolsTheme;
  banner?: string;
}

export interface FigDevtoolsPanelOptions extends FigDevtoolsInstallOptions {
  hook: FigDevtoolsHook;
}

export type FigDevtoolsPanelUpdate = Omit<
  FigDevtoolsPanelOptions,
  "hook" | "target"
>;

export interface FigDevtoolsController {
  hook: FigDevtoolsHook;
  show(): void;
  hide(): void;
  toggle(): void;
  update(options: FigDevtoolsPanelUpdate): void;
  uninstall(): void;
}

interface MountedPanel {
  root: ReturnType<typeof createRoot>;
  container: HTMLElement;
  open: boolean;
  options: FigDevtoolsPanelOptions;
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
    options,
    root: createRoot(container, { devtools: false }),
  };

  target.appendChild(container);
  syncPanelContainer(mounted);
  renderMountedPanel(mounted);

  return {
    hook: options.hook,
    show() {
      mounted.open = true;
      renderMountedPanel(mounted);
    },
    hide() {
      mounted.open = false;
      renderMountedPanel(mounted);
    },
    toggle() {
      mounted.open = !mounted.open;
      renderMountedPanel(mounted);
    },
    update(nextOptions) {
      mounted.options = { ...mounted.options, ...nextOptions };
      if (nextOptions.open !== undefined) mounted.open = nextOptions.open;
      syncPanelContainer(mounted);
      renderMountedPanel(mounted);
    },
    uninstall() {
      mounted.root.unmount();
      mounted.container.remove();
    },
  };
}

function syncPanelContainer(mounted: MountedPanel): void {
  const fillsTarget =
    mounted.options.placement === "panel" ||
    mounted.options.placement === "sidebar";
  mounted.container.style.width = fillsTarget ? "100%" : "";
  mounted.container.style.height = fillsTarget ? "100%" : "";
}

function renderMountedPanel(mounted: MountedPanel): void {
  flushSync(() =>
    mounted.root.render(
      createElement(FigDevtools, {
        banner: mounted.options.banner,
        collapsible: mounted.options.collapsible,
        hook: mounted.options.hook,
        open: mounted.open,
        overlayTarget: mounted.options.overlayTarget,
        overlayZIndex: mounted.options.overlayZIndex,
        placement: mounted.options.placement,
        position: mounted.options.position,
        theme: mounted.options.theme,
        onOpenChange: (open: boolean) => {
          mounted.open = open;
          renderMountedPanel(mounted);
        },
      }),
    ),
  );
}
