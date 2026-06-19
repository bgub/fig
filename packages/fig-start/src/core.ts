import type { AnyRoute } from "./route.ts";
import type { RouterLocation } from "./types.ts";

// A URL-contributing segment of a route, relative to its parent. Pathless
// layout segments ("_authed") contribute no URL segment and never appear here.
export type RouteSegment =
  | { kind: "param"; name: string }
  | { kind: "splat" }
  | { kind: "static"; value: string };

export interface RouteNode {
  children: RouteNode[];
  fullPath: string;
  id: string;
  // An index route renders at its parent's path (e.g. "/posts/" at "/posts").
  isIndex: boolean;
  isRoot: boolean;
  parent: RouteNode | null;
  route: AnyRoute;
  // URL segments this node adds beyond its parent (may be empty for pathless
  // layouts and index routes).
  segments: RouteSegment[];
}

export interface RouteMatch {
  context: unknown;
  loaderData: unknown;
  node: RouteNode;
  params: Record<string, string>;
  routeId: string;
}

export interface RouterState {
  location: RouterLocation;
  matches: RouteMatch[];
  notFound: boolean;
  params: Record<string, string>;
  status: "idle" | "pending";
}

export interface NavigateOptions {
  hash?: string;
  replace?: boolean;
  search?: string;
  to: string;
}

export interface Router {
  buildLocation(to: NavigateOptions | string): RouterLocation;
  getState(): RouterState;
  navigate(options: NavigateOptions | string): Promise<void>;
  subscribe(listener: () => void): () => void;
}
