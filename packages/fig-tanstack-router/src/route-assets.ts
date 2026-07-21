import {
  assets,
  createElement,
  type FigAssetResource,
  type FigNode,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceFromHostProps,
  preventAssetResourceHoist,
} from "@bgub/fig/internal";
import {
  getAssetCrossOrigin,
  getScriptPreloadAttrs,
  resolveManifestCssLink,
  type AnyRouteMatch,
  type AnyRouter,
  type Manifest,
  type RouterManagedTag,
} from "@tanstack/router-core";

interface RouteAssets {
  resources: FigAssetResource[];
  links: RouterManagedTag[];
  headScripts: RouterManagedTag[];
  scripts: RouterManagedTag[];
}

export function collectRouteAssets(
  router: AnyRouter,
  match: AnyRouteMatch,
  manifest: Manifest | undefined,
): RouteAssets {
  const nonce = router.options.ssr?.nonce;
  const resources: FigAssetResource[] = [];
  const links: RouterManagedTag[] = [];
  const headScripts: RouterManagedTag[] = [];
  const scripts: RouterManagedTag[] = [];
  const manifestRoute = manifest?.routes[match.routeId];

  for (const link of manifestRoute?.preloads ?? []) {
    collectTag(
      {
        tag: "link",
        attrs: {
          ...getScriptPreloadAttrs(
            manifest,
            link,
            router.options.assetCrossOrigin,
          ),
          nonce,
        },
      },
      resources,
      links,
    );
  }

  for (const link of match.links ?? []) {
    if (link === undefined) continue;
    collectTag({ tag: "link", attrs: { ...link, nonce } }, resources, links);
  }

  for (const link of manifestRoute?.css ?? []) {
    const resolved = resolveManifestCssLink(link);
    collectTag(
      {
        tag: "link",
        attrs: {
          rel: "stylesheet",
          ...resolved,
          crossOrigin:
            getAssetCrossOrigin(
              router.options.assetCrossOrigin,
              "stylesheet",
            ) ?? resolved.crossOrigin,
          nonce,
          suppressHydrationWarning: true,
        },
      },
      resources,
      links,
    );
  }

  collectScripts(match.headScripts, nonce, resources, headScripts);
  collectScripts(match.scripts, nonce, resources, scripts);

  for (const script of manifestRoute?.scripts ?? []) {
    collectTag(
      {
        tag: "script",
        attrs: { ...script.attrs, nonce },
        children: script.children,
      },
      resources,
      scripts,
    );
  }

  return { resources, links, headScripts, scripts };
}

export function renderRouterHeadTags(tags: RouterManagedTag[]): FigNode {
  const resources: FigAssetResource[] = [];
  const nodes: FigNode[] = [];
  for (const tag of tags) {
    const resource = resourceFromTag(tag);
    if (resource === null || assetResourceDestination(resource) !== "head") {
      nodes.push(renderPositionedRouterTag(tag));
    } else {
      resources.push(resource);
    }
  }
  return resources.length === 0 ? nodes : assets(resources, nodes);
}

export function renderPositionedRouterTag(tag: RouterManagedTag): FigNode {
  return createElement(
    tag.tag,
    preventAssetResourceHoist({
      ...nativeAttributes(tag.attrs),
      ...(tag.children === undefined ? {} : { unsafeHTML: tag.children }),
    }),
  );
}

function nativeAttributes(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (attrs === undefined) return {};
  const result = { ...attrs };
  renameAttribute(result, "charSet", "charset");
  renameAttribute(result, "className", "class");
  renameAttribute(result, "crossOrigin", "crossorigin");
  renameAttribute(result, "fetchPriority", "fetchpriority");
  renameAttribute(result, "httpEquiv", "http-equiv");
  renameAttribute(result, "referrerPolicy", "referrerpolicy");
  return result;
}

function collectScripts(
  values: AnyRouteMatch["scripts"],
  nonce: string | undefined,
  resources: FigAssetResource[],
  positioned: RouterManagedTag[],
): void {
  for (const script of values ?? []) {
    if (script === undefined) continue;
    const { children, ...attrs } = script;
    collectTag(
      {
        tag: "script",
        attrs: { ...attrs, nonce, suppressHydrationWarning: true },
        children: children as string | undefined,
      },
      resources,
      positioned,
    );
  }
}

function collectTag(
  tag: RouterManagedTag,
  resources: FigAssetResource[],
  positioned: RouterManagedTag[],
): void {
  const resource = resourceFromTag(tag);
  if (resource === null) positioned.push(tag);
  else resources.push(resource);
}

function resourceFromTag(tag: RouterManagedTag): FigAssetResource | null {
  return assetResourceFromHostProps(tag.tag, {
    ...nativeAttributes(tag.attrs),
    children: tag.children,
  });
}

function renameAttribute(
  attrs: Record<string, unknown>,
  from: string,
  to: string,
): void {
  if (attrs[from] !== undefined && attrs[to] === undefined) {
    attrs[to] = attrs[from];
  }
  delete attrs[from];
}
