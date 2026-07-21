import type { TanStackDevtoolsPlugin } from "@tanstack/devtools";
import type { FigDevtoolsHook } from "./hook.ts";
import { ensureFigDevtoolsGlobalHook } from "./hook.ts";
import { mountFigDevtoolsPanel, type FigDevtoolsController } from "./panel.ts";

export interface FigDevtoolsPluginOptions {
  banner?: string;
  defaultOpen?: boolean;
  hook?: FigDevtoolsHook;
  id?: string;
  name?: TanStackDevtoolsPlugin["name"];
}

export interface FigTanStackDevtoolsPlugin extends TanStackDevtoolsPlugin {
  /** Explicit teardown for hosts whose unmount path does not call destroy. */
  dispose(): void;
}

export function createFigDevtoolsPlugin(
  options: FigDevtoolsPluginOptions = {},
): FigTanStackDevtoolsPlugin {
  const mounts = new Map<HTMLDivElement, FigDevtoolsController>();
  let hook = options.hook;

  const dispose = () => {
    for (const controller of mounts.values()) controller.uninstall();
    mounts.clear();
  };

  return {
    defaultOpen: options.defaultOpen ?? true,
    destroy: dispose,
    dispose,
    id: options.id ?? "fig",
    name: options.name ?? "Fig",
    render(target, { theme }) {
      removeDisconnectedMounts(mounts, target);
      const overlayTarget =
        target.ownerDocument.body ?? target.ownerDocument.documentElement;
      const overlayZIndex = overlayZIndexBelowHost(target);

      const mounted = mounts.get(target);
      if (mounted !== undefined) {
        mounted.update({
          banner: options.banner,
          collapsible: false,
          open: true,
          overlayTarget,
          overlayZIndex,
          placement: "panel",
          theme,
        });
        return;
      }

      hook ??= ensureFigDevtoolsGlobalHook();
      mounts.set(
        target,
        mountFigDevtoolsPanel({
          banner: options.banner,
          collapsible: false,
          hook,
          open: true,
          overlayTarget,
          overlayZIndex,
          placement: "panel",
          target,
          theme,
        }),
      );
    },
  };
}

function overlayZIndexBelowHost(target: Element): number {
  const view = target.ownerDocument.defaultView;
  let outermostAncestorZIndex = 0;
  let ancestor: Element | null = target;

  while (ancestor !== null) {
    const zIndex = Number.parseInt(
      view?.getComputedStyle(ancestor).zIndex ?? "",
    );
    if (Number.isFinite(zIndex)) {
      outermostAncestorZIndex = zIndex;
    }
    ancestor = ancestor.parentElement;
  }

  return Math.max(0, outermostAncestorZIndex - 1);
}

function removeDisconnectedMounts(
  mounts: Map<HTMLDivElement, FigDevtoolsController>,
  activeTarget: HTMLDivElement,
): void {
  for (const [target, controller] of mounts) {
    if (target === activeTarget || target.isConnected) continue;
    controller.uninstall();
    mounts.delete(target);
  }
}
