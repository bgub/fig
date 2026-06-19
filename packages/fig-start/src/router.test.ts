import { describe, expect, it } from "vite-plus/test";
import { redirect } from "./redirect.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRouter } from "./router.ts";

const routes = [
  createRootRoute(),
  createFileRoute("/")(),
  createFileRoute("/_authed")({
    beforeLoad: ({ context }) => {
      if (!(context as { isAdmin: boolean }).isAdmin)
        throw redirect({ to: "/" });
      return { entered: true };
    },
  }),
  createFileRoute("/_authed/admin")({
    loader: () => ({ stat: 42 }),
  }),
  createFileRoute("/posts/$postId")({
    loader: ({ params }) => ({ id: params.postId }),
  }),
];

function makeRouter(isAdmin: boolean) {
  return createRouter({ context: { isAdmin }, routes });
}

describe("@bgub/fig-start router", () => {
  it("redirects from a guarded route when beforeLoad throws", async () => {
    const router = makeRouter(false);
    const result = await router.load(router.buildLocation("/admin"));
    expect(result.status).toBe("redirect");
    if (result.status === "redirect") expect(result.redirect.to).toBe("/");
  });

  it("runs loaders and exposes loader data on the leaf match", async () => {
    const router = makeRouter(true);
    const result = await router.load(router.buildLocation("/admin"));
    expect(result.status).toBe("match");
    if (result.status !== "match") return;
    expect(result.matches.map((match) => match.routeId)).toEqual([
      "__root__",
      "/_authed",
      "/_authed/admin",
    ]);
    expect(result.matches.at(-1)?.loaderData).toEqual({ stat: 42 });
  });

  it("accumulates context from beforeLoad down the chain", async () => {
    const router = makeRouter(true);
    const result = await router.load(router.buildLocation("/admin"));
    if (result.status !== "match") throw new Error("expected match");
    const authed = result.matches.find((m) => m.routeId === "/_authed");
    expect(authed?.context).toMatchObject({ isAdmin: true, entered: true });
  });

  it("passes typed params to loaders", async () => {
    const router = makeRouter(true);
    const result = await router.load(router.buildLocation("/posts/7"));
    if (result.status !== "match") throw new Error("expected match");
    expect(result.matches.at(-1)?.loaderData).toEqual({ id: "7" });
  });

  it("reports notFound for an unmatched path", async () => {
    const router = makeRouter(true);
    const result = await router.load(router.buildLocation("/missing"));
    expect(result.status).toBe("notFound");
  });

  it("commits matches into observable state", async () => {
    const router = makeRouter(true);
    const location = router.buildLocation("/posts/7");
    const result = await router.load(location);
    router.commit(location, result);
    expect(router.getState().params).toEqual({ postId: "7" });
    expect(router.getState().status).toBe("idle");
  });
});
