import type { FigNode, FigPortal, Key } from "@bgub/fig";
import { createPortalNode } from "@bgub/fig/internal";
import type {
  FigRoot,
  FigRootOptions,
  RecoverableErrorInfo,
} from "@bgub/fig-reconciler";
import { composeBind } from "./bind.ts";
import {
  type EventCallback,
  type EventDescriptor,
  type EventOptions,
  on,
} from "./event-descriptor.ts";
import { type Container, registerRoot, unregisterRoot } from "./events.ts";
import { domRenderer } from "./renderer.ts";

export { insertAssetResources } from "./asset-resources.ts";
export type { Bind } from "./bind.ts";
export { composeBind };
export { type EventCallback, type EventDescriptor, type EventOptions, on };
export type {
  EmptyPropValue,
  HostEvents,
  HostIntrinsicElements,
  HostProps,
  HostStyle,
} from "./jsx.ts";
export {
  payloadDataLoader,
  type PayloadDataLoaderOptions,
} from "./payload-loader.ts";

export type { Container, FigRoot, FigRootOptions, RecoverableErrorInfo };

export const flushSync = domRenderer.flushSync;

export function createRoot(
  container: Container,
  options?: FigRootOptions,
): FigRoot {
  const root = domRenderer.createRoot(container, options);
  registerRoot(container, { run: (callback) => root.data.run(callback) });
  return withEventTeardown(root, container);
}

export function hydrateRoot(
  container: Container,
  children: FigNode,
  options?: FigRootOptions,
): FigRoot {
  const root = domRenderer.hydrateRoot(container, children, options);
  registerRoot(container, {
    hydrate: (target, priority) =>
      domRenderer.hydrateTarget(container, target, priority),
    run: (callback) => root.data.run(callback),
  });
  return withEventTeardown(root, container);
}

export function createPortal(
  children: FigNode,
  container: Container,
  key: Key | null = null,
): FigPortal<Container> {
  return createPortalNode(children, container, key);
}

// Event routing lives outside the reconciler, so root teardown owns both.
function withEventTeardown(root: FigRoot, container: Container): FigRoot {
  return {
    ...root,
    unmount: () => {
      root.unmount();
      unregisterRoot(container);
    },
  };
}
