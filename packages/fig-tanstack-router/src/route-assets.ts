import {
  assets,
  createElement,
  type FigAssetResource,
  type FigNode,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceFromHostValues,
  preventAssetResourceHoist,
} from "@bgub/fig/internal";
import {
  appendUniqueUserTags,
  getAssetCrossOrigin,
  getScriptPreloadAttrs,
  resolveManifestCssLink,
  type AnyRouteMatch,
  type AnyRouter,
  escapeHtml,
  type Manifest,
  type RouterManagedTag,
} from "@tanstack/router-core";

interface RouteAssets {
  resources: FigAssetResource[];
  links: RouterManagedTag[];
  headScripts: RouterManagedTag[];
  scripts: RouterManagedTag[];
}

interface CachedRouteAssets {
  manifest: Manifest | undefined;
  router: AnyRouter;
  value: RouteAssets;
}

const routeAssetsCache = new WeakMap<AnyRouteMatch, CachedRouteAssets>();

const inlineCssHydrationAttribute = "data-tsr-inline-css";

export function collectRouteAssets(
  router: AnyRouter,
  match: AnyRouteMatch,
  manifest: Manifest | undefined,
): RouteAssets {
  if (router.isServer) {
    const cached = routeAssetsCache.get(match);
    if (cached?.router === router && cached.manifest === manifest) {
      return cached.value;
    }
  }

  const nonce = router.options.ssr?.nonce;
  const resources: FigAssetResource[] = [];
  const links: RouterManagedTag[] = [];
  const headScripts: RouterManagedTag[] = [];
  const scripts: RouterManagedTag[] = [];
  const manifestRoute = manifest?.routes[match.routeId];

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

  const value = { resources, links, headScripts, scripts };
  if (router.isServer) {
    routeAssetsCache.set(match, { manifest, router, value });
  }
  return value;
}

export function collectRouterHeadTags(
  router: AnyRouter,
  matches: AnyRouteMatch[],
  manifest: Manifest | undefined,
): RouterManagedTag[] {
  const nonce = router.options.ssr?.nonce;
  const metaTags: RouterManagedTag[] = [];
  const seenMeta = new Set<string>();
  let selectedTitle: RouterManagedTag | undefined;

  for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const routeMeta = matches[matchIndex]?.meta ?? [];
    for (let metaIndex = routeMeta.length - 1; metaIndex >= 0; metaIndex -= 1) {
      const value = routeMeta[metaIndex];
      if (value === undefined) continue;
      const title =
        "title" in value && typeof value.title === "string"
          ? value.title
          : undefined;
      if (title !== undefined) {
        selectedTitle ??= { tag: "title", children: title };
        continue;
      }
      if ("script:ld+json" in value) {
        try {
          metaTags.push({
            tag: "script",
            attrs: { type: "application/ld+json" },
            children: escapeHtml(JSON.stringify(value["script:ld+json"])),
          });
        } catch {
          // Invalid JSON-LD is omitted, matching TanStack Router's adapters.
        }
        continue;
      }
      const identity =
        ("name" in value && typeof value.name === "string"
          ? value.name
          : undefined) ??
        ("property" in value && typeof value.property === "string"
          ? value.property
          : undefined);
      if (identity !== undefined) {
        if (seenMeta.has(identity)) continue;
        seenMeta.add(identity);
      }
      metaTags.push({ tag: "meta", attrs: { ...value, nonce } });
    }
  }
  if (selectedTitle !== undefined) metaTags.push(selectedTitle);
  if (nonce !== undefined) {
    metaTags.push({
      tag: "meta",
      attrs: { content: nonce, property: "csp-nonce" },
    });
  }
  metaTags.reverse();

  const links: RouterManagedTag[] = [];
  const styles: RouterManagedTag[] = [];
  const headScripts: RouterManagedTag[] = [];
  for (const match of matches) {
    const routeAssets = collectRouteAssets(router, match, manifest);
    for (const link of routeAssets.links) links.push(link);
    for (const script of routeAssets.headScripts) headScripts.push(script);
    for (const style of match.styles ?? []) {
      if (style === undefined) continue;
      const { children, ...attrs } = style;
      styles.push({
        tag: "style",
        attrs: { ...attrs, nonce },
        children: children as string | undefined,
      });
    }
  }

  const tags: RouterManagedTag[] = [];
  appendUniqueUserTags(tags, metaTags);
  appendUniqueUserTags(tags, links);
  if (manifest?.inlineStyle !== undefined) {
    tags.push({
      tag: "style",
      attrs: { ...manifest.inlineStyle.attrs, nonce },
      children: manifest.inlineStyle.children,
      inlineCss: true,
    });
  }
  appendUniqueUserTags(tags, styles);
  appendUniqueUserTags(tags, headScripts);
  return tags;
}

export function renderRouterHeadTags(
  tags: RouterManagedTag[],
  ownerDocument?: Document,
): FigNode {
  const resources: FigAssetResource[] = [];
  const nodes: FigNode[] = [];
  for (const tag of tags) {
    const resource = resourceFromTag(tag);
    if (resource === null || assetResourceDestination(resource) !== "head") {
      nodes.push(renderPositionedRouterTag(tag, ownerDocument));
    } else {
      resources.push(resource);
    }
  }
  return resources.length === 0 ? nodes : assets(resources, nodes);
}

export function renderPositionedRouterTag(
  tag: RouterManagedTag,
  ownerDocument?: Document,
): FigNode {
  const inlineCss = tag.tag === "style" && tag.inlineCss === true;
  const props = nativeAttributes(tag.attrs);
  if (inlineCss) props[inlineCssHydrationAttribute] = "";
  const children =
    inlineCss && tag.children === undefined
      ? hydratedInlineCss(ownerDocument)
      : tag.children;
  if (children !== undefined) props.unsafeHTML = children;
  return createElement(tag.tag, preventAssetResourceHoist(props));
}

function hydratedInlineCss(ownerDocument: Document | undefined): string {
  return (
    (ownerDocument ?? globalThis.document)?.querySelector<HTMLStyleElement>(
      `style[${inlineCssHydrationAttribute}]`,
    )?.textContent ?? ""
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
  return assetResourceFromHostValues(
    tag.tag,
    (name) => routerTagAttribute(tag.attrs, name),
    tag.children,
    true,
  );
}

function routerTagAttribute(
  attrs: Record<string, unknown> | undefined,
  name: string,
): unknown {
  const value = attrs?.[name];
  if (value !== undefined) return value;
  switch (name) {
    case "charset":
      return attrs?.charSet;
    case "crossorigin":
      return attrs?.crossOrigin;
    case "fetchpriority":
      return attrs?.fetchPriority;
    case "http-equiv":
      return attrs?.httpEquiv;
    case "referrerpolicy":
      return attrs?.referrerPolicy;
    default:
      return undefined;
  }
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
