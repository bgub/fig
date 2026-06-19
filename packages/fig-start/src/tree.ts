import type { RouteNode, RouteSegment } from "./core.ts";
import { type AnyRoute } from "./route.ts";

interface ParsedRoute {
  isIndex: boolean;
  raw: string[];
  route: AnyRoute;
  url: string[];
}

export interface MatchedRoute {
  node: RouteNode;
  params: Record<string, string>;
}

export function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((part) => part.length > 0);
}

function isPathless(segment: string): boolean {
  return segment.startsWith("_");
}

function parseSegment(segment: string): RouteSegment {
  if (segment === "$") return { kind: "splat" };
  if (segment.startsWith("$")) return { kind: "param", name: segment.slice(1) };
  return { kind: "static", value: segment };
}

function parseRoute(route: AnyRoute): ParsedRoute {
  const path = route.path;
  const isIndex = path === "/" || (path.length > 1 && path.endsWith("/"));
  const raw = splitPath(path);
  return { isIndex, raw, route, url: raw.filter((part) => !isPathless(part)) };
}

function isProperPrefix(prefix: string[], of: string[]): boolean {
  if (prefix.length >= of.length) return false;
  return prefix.every((part, index) => of[index] === part);
}

export function buildRouteTree(routes: readonly AnyRoute[]): RouteNode {
  const rootRoute = routes.find((route) => route.isRoot);
  if (rootRoute === undefined) {
    throw new Error("A root route (createRootRoute) is required.");
  }

  const parsed = routes
    .filter((route) => !route.isRoot)
    .map(parseRoute)
    // Build shallow-to-deep so a parent always exists before its child; among
    // equal depth, layouts before their index so the index can find its layout.
    .sort(
      (a, b) =>
        a.raw.length - b.raw.length || Number(a.isIndex) - Number(b.isIndex),
    );

  const root: RouteNode = {
    children: [],
    fullPath: rootRoute.path,
    id: rootRoute.id,
    isIndex: false,
    isRoot: true,
    parent: null,
    route: rootRoute,
    segments: [],
  };

  const created: { node: RouteNode; parsed: ParsedRoute }[] = [];
  const urlLenOf = new Map<RouteNode, number>([[root, 0]]);

  for (const entry of parsed) {
    const parent = findParent(entry);
    const parentUrlLen = urlLenOf.get(parent) ?? 0;
    const node: RouteNode = {
      children: [],
      fullPath: entry.route.path,
      id: entry.route.id,
      isIndex: entry.isIndex,
      isRoot: false,
      parent,
      route: entry.route,
      segments: entry.url.slice(parentUrlLen).map(parseSegment),
    };
    parent.children.push(node);
    created.push({ node, parsed: entry });
    urlLenOf.set(node, entry.url.length);
  }

  return root;

  function findParent(entry: ParsedRoute): RouteNode {
    // An index route nests under a layout sharing its exact raw path, if any.
    if (entry.isIndex) {
      const layout = created.find(
        ({ parsed }) =>
          !parsed.isIndex &&
          parsed.raw.length === entry.raw.length &&
          parsed.raw.every((part, index) => entry.raw[index] === part),
      );
      if (layout !== undefined) return layout.node;
    }

    // Otherwise the nearest ancestor layout whose raw path is a proper prefix.
    let best: RouteNode = root;
    let bestLen = 0;
    for (const { node, parsed } of created) {
      if (parsed.isIndex || !isProperPrefix(parsed.raw, entry.raw)) continue;
      if (parsed.raw.length >= bestLen) {
        best = node;
        bestLen = parsed.raw.length;
      }
    }
    return best;
  }
}

export function matchRoutes(
  root: RouteNode,
  pathname: string,
): MatchedRoute[] | null {
  const segments = splitPath(pathname);
  const candidates: { chain: MatchedRoute[]; score: number[] }[] = [];

  visit(root, segments, {}, [], []);

  let best: { chain: MatchedRoute[]; score: number[] } | undefined;
  for (const candidate of candidates) {
    if (best === undefined || isBetterScore(candidate.score, best.score)) {
      best = candidate;
    }
  }
  return best === undefined ? null : best.chain;

  function visit(
    node: RouteNode,
    remaining: string[],
    params: Record<string, string>,
    chain: MatchedRoute[],
    score: number[],
  ): void {
    let rem = remaining;
    const nextParams = { ...params };
    const nextScore = [...score];

    for (const segment of node.segments) {
      if (segment.kind === "static") {
        if (rem.length === 0 || rem[0] !== segment.value) return;
        rem = rem.slice(1);
        nextScore.push(2);
      } else if (segment.kind === "param") {
        if (rem.length === 0) return;
        nextParams[segment.name] = safeDecode(rem[0] as string);
        rem = rem.slice(1);
        nextScore.push(1);
      } else {
        nextParams._splat = rem.map(safeDecode).join("/");
        rem = [];
        nextScore.push(0);
      }
    }

    const nextChain: MatchedRoute[] = [...chain, { node, params: nextParams }];

    const canBeLeaf = node.children.length === 0 || node.isIndex;
    if (rem.length === 0 && canBeLeaf && !node.isRoot) {
      candidates.push({ chain: nextChain, score: nextScore });
    }

    for (const child of node.children) {
      visit(child, rem, nextParams, nextChain, nextScore);
    }
  }
}

function isBetterScore(a: number[], b: number[]): boolean {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? -1;
    const bv = b[index] ?? -1;
    if (av !== bv) return av > bv;
  }
  return false;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
