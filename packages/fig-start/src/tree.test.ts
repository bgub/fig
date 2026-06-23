import { describe, expect, it } from "vite-plus/test";
import { createFileRoute, createRootRoute } from "./route.ts";
import { buildRouteTree, matchRoutes } from "./tree.ts";

const routes = [
  createRootRoute(),
  createFileRoute("/")(),
  createFileRoute("/about")(),
  createFileRoute("/_authed")(),
  createFileRoute("/_authed/admin")(),
  createFileRoute("/posts")(),
  createFileRoute("/posts/")(),
  createFileRoute("/posts/$postId")(),
  createFileRoute("/files/$")(),
];

const tree = buildRouteTree(routes);

function matchIds(pathname: string): string[] | null {
  const matches = matchRoutes(tree, pathname);
  return matches === null ? null : matches.map((match) => match.node.id);
}

describe("@bgub/fig-start route matching", () => {
  it("matches the root index", () => {
    expect(matchIds("/")).toEqual(["__root__", "/"]);
  });

  it("matches a static route", () => {
    expect(matchIds("/about")).toEqual(["__root__", "/about"]);
  });

  it("threads a pathless layout into the chain without a URL segment", () => {
    expect(matchIds("/admin")).toEqual([
      "__root__",
      "/_authed",
      "/_authed/admin",
    ]);
  });

  it("resolves a layout path to its index child", () => {
    expect(matchIds("/posts")).toEqual(["__root__", "/posts", "/posts/"]);
  });

  it("matches a dynamic param and exposes it", () => {
    const matches = matchRoutes(tree, "/posts/123");
    expect(matches?.map((match) => match.node.id)).toEqual([
      "__root__",
      "/posts",
      "/posts/$postId",
    ]);
    expect(matches?.at(-1)?.params).toEqual({ postId: "123" });
  });

  it("prefers a static segment over a dynamic one", () => {
    // "/posts" index beats "/posts/$postId" for the bare "/posts" path.
    expect(matchIds("/posts")).toEqual(["__root__", "/posts", "/posts/"]);
  });

  it("captures a splat as _splat", () => {
    const matches = matchRoutes(tree, "/files/a/b/c");
    expect(matches?.at(-1)?.node.id).toBe("/files/$");
    expect(matches?.at(-1)?.params).toEqual({ _splat: "a/b/c" });
  });

  it("decodes param values", () => {
    const matches = matchRoutes(tree, "/posts/hello%20world");
    expect(matches?.at(-1)?.params).toEqual({ postId: "hello world" });
  });

  it("returns null for an unmatched path", () => {
    expect(matchIds("/nope/nope")).toBeNull();
  });

  it("rejects a server route that has child routes", () => {
    expect(() =>
      buildRouteTree([
        createRootRoute(),
        createFileRoute("/dash")({ server: true }),
        createFileRoute("/dash/settings")(),
      ]),
    ).toThrow(/cannot have child routes/);
  });
});
