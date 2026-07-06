import { describe, expect, it } from "vite-plus/test";
import {
  assertNoRemoteDataResourceImport,
  clientRefId,
  transformServerModule,
  transformServerRouteClientStub,
} from "./transform.ts";
import { rootRelative } from "./path-utils.ts";

const root = "/project";

describe("@bgub/fig-start/vite server transform", () => {
  it("rewrites a .tsx import in a .server.tsx into a client reference", async () => {
    const code = `import { Island } from "./Island.tsx";
export function Dashboard() {
  return <div><Island /></div>;
}`;
    const out = await transformServerModule(
      code,
      "/project/src/routes/dashboard.server.tsx",
      root,
    );

    expect(out.clientRefs).toEqual([
      {
        id: "/src/routes/Island.tsx#Island",
        specifier: "/src/routes/Island.tsx",
      },
    ]);
    expect(out.code).toContain("serverClientReference as __figClientRef");
    expect(out.code).toContain("__figClientRef(");
    expect(out.code).toContain("ssr:");
    expect(out.code).toContain('"/src/routes/Island.tsx#Island"');
    // The original module stays in the server graph under a private alias so
    // the document render can SSR the island while payload still sees a client ref.
    expect(out.code).toContain('from "./Island.tsx"');
  });

  it("uses the exported name for an aliased import", async () => {
    const out = await transformServerModule(
      `import { Counter as C } from "./widgets/Counter.tsx";\nexport function P(){ return <C/>; }`,
      "/project/src/p.server.tsx",
      root,
    );
    expect(out.clientRefs).toEqual([
      {
        id: "/src/widgets/Counter.tsx#Counter",
        specifier: "/src/widgets/Counter.tsx",
      },
    ]);
    expect(out.code).toContain("const C =");
    expect(out.code).toContain('"/src/widgets/Counter.tsx#Counter"');
  });

  it("ignores non-client imports and reports no client refs", async () => {
    const out = await transformServerModule(
      `import { readData } from "@bgub/fig";\nexport function X(){ return null; }`,
      "/project/src/x.server.tsx",
      root,
    );
    expect(out.clientRefs).toEqual([]);
    expect(out.code).not.toContain("__figClientRef");
  });

  it("marks a .server.tsx route export as a server route", async () => {
    const out = await transformServerModule(
      `import { createFileRoute } from "@bgub/fig-start";
export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});
function Dashboard() { return null; }`,
      "/project/src/routes/dashboard.server.tsx",
      root,
    );

    expect(out.marksServerRoute).toBe(true);
    expect(out.code).toContain("markServerRoute as __figMarkServerRoute");
    expect(out.code).toContain("__figMarkServerRoute(Route)");
  });

  it("does not mark an imported Route binding", async () => {
    const out = await transformServerModule(
      `import { Route } from "./other.ts";
export function Helper() { return Route.id; }`,
      "/project/src/routes/helper.server.tsx",
      root,
    );

    expect(out.marksServerRoute).toBe(false);
    expect(out.code).not.toContain("__figMarkServerRoute(Route)");
  });

  it("does not mark a local Route binding that is not a literal file route", async () => {
    const primitive = await transformServerModule(
      `const Route = "/admin";\nexport function Helper() { return Route; }`,
      "/project/src/routes/helper.server.tsx",
      root,
    );
    const computed = await transformServerModule(
      `import { createFileRoute } from "@bgub/fig-start";
const path = "/dashboard";
export const Route = createFileRoute(path)({
  component: Dashboard,
});
function Dashboard() { return null; }`,
      "/project/src/routes/dashboard.server.tsx",
      root,
    );

    expect(primitive.marksServerRoute).toBe(false);
    expect(primitive.code).not.toContain("__figMarkServerRoute(Route)");
    expect(computed.marksServerRoute).toBe(false);
    expect(computed.code).not.toContain("__figMarkServerRoute(Route)");
  });

  it("stubs a .server.tsx route for browser bundles", async () => {
    const out = await transformServerRouteClientStub(
      `import { createFileRoute } from "@bgub/fig-start";
import { secret } from "../db.ts";
import { Island } from "./Island.tsx";
export const Route = createFileRoute("/dashboard")({
  loader: () => secret,
  component: Dashboard,
});
function Dashboard() { return <Island />; }`,
      "/project/src/routes/dashboard.server.tsx",
      root,
    );

    expect(out.routePath).toBe("/dashboard");
    expect(out.code).toContain('createFileRoute("/dashboard")');
    expect(out.code).toContain("__figMarkServerRoute");
    expect(out.code).not.toContain("../db.ts");
    expect(out.code).not.toContain("Island");
    expect(out.code).not.toContain("Dashboard");
    const map = out.map as { sourcesContent: string[] };
    expect(map.sourcesContent.join("\n")).not.toContain("../db.ts");
    expect(map.sourcesContent.join("\n")).not.toContain("Dashboard");
    expect(map.sourcesContent).toEqual([out.code]);
  });

  it("rejects browser stubs for non-literal file routes", async () => {
    const out = await transformServerRouteClientStub(
      `import { createFileRoute } from "@bgub/fig-start";
const path = "/dashboard";
export const Route = createFileRoute(path)({
  component: Dashboard,
});
function Dashboard() { return null; }`,
      "/project/src/routes/dashboard.server.tsx",
      root,
    );

    expect(out.routePath).toBe(null);
    expect(out.code).toContain("Cannot import server module");
    expect(out.code).not.toContain("Dashboard");
  });

  it("rejects browser imports of non-route .server.tsx modules", async () => {
    const out = await transformServerRouteClientStub(
      `export function readSecret() { return "secret"; }`,
      "/project/src/server-only.server.tsx",
      root,
    );

    expect(out.routePath).toBe(null);
    expect(out.code).toContain("Cannot import server module");
    expect(out.code).not.toContain("readSecret");
    const map = out.map as { sourcesContent: string[] };
    expect(map.sourcesContent.join("\n")).not.toContain("readSecret");
  });

  it("errors on a namespace import of a client module", async () => {
    await expect(
      transformServerModule(
        `import * as Widgets from "./Widget.tsx";\nexport function P(){ return <Widgets.X/>; }`,
        "/project/src/p.server.tsx",
        root,
      ),
    ).rejects.toThrow(/import \* as/);
  });

  it("discovers remoteDataResource declarations in server modules", async () => {
    const out = await transformServerModule(
      `import { remoteDataResource } from "@bgub/fig-start/server";
export const userResource = remoteDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.serverDataResources).toEqual([
      {
        exportName: "userResource",
        id: "/src/data/user.server.ts#userResource",
        specifier: "/src/data/user.server.ts",
      },
    ]);
  });

  it("does not register server-only data resources for endpoints", async () => {
    const out = await transformServerModule(
      `import { serverDataResource } from "@bgub/fig/server";
export const userResource = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.serverDataResources).toEqual([]);
  });

  it("stubs server data resources for browser bundles", async () => {
    const out = await transformServerRouteClientStub(
      `import { serverDataResource } from "@bgub/fig/server";
import { remoteDataResource } from "@bgub/fig-start/server";
import { db } from "./db.server.ts";
export const localResource = serverDataResource({
  key: (id: string) => ["local-user", id],
  load: async (id: string) => db.user(id),
});
export const userResource = remoteDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => db.user(id),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.routePath).toBe(null);
    expect(out.code).toContain("dataResource as __figDataResource");
    expect(out.code).toContain(
      "export const localResource = __figDataResource",
    );
    expect(out.code).toContain("remoteDataLoader as __figRemoteDataLoader");
    expect(out.code).toContain(
      'load: __figRemoteDataLoader("/src/data/user.server.ts#userResource")',
    );
    expect(out.code).toContain('key: (id: string) => ["user", id]');
    expect(out.code).not.toContain("db.user");
  });

  it("does not import the remote loader for stubs without remote resources", async () => {
    const out = await transformServerRouteClientStub(
      `import { serverDataResource } from "@bgub/fig/server";
export const localResource = serverDataResource({
  key: (id: string) => ["local-user", id],
  load: async (id: string) => ({ id }),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.code).not.toContain("__figRemoteDataLoader");
  });

  it("preserves shared imports referenced by remote data resource stubs", async () => {
    const out = await transformServerRouteClientStub(
      `import { remoteDataResource } from "@bgub/fig-start/server";
import { userKey as keyForUser } from "./user.keys.ts";
import { db } from "./db.server.ts";
export const userResource = remoteDataResource({
  key: keyForUser,
  load: async (id: string) => db.user(id),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.code).toContain(
      `import { userKey as keyForUser } from "./user.keys.ts";`,
    );
    expect(out.code).toContain("key: keyForUser");
    expect(out.code).not.toContain("db.server");
  });

  it("rejects remote data resource stubs that reference server-only imports", async () => {
    await expect(
      transformServerRouteClientStub(
        `import { remoteDataResource } from "@bgub/fig-start/server";
import { userKey } from "./user.keys.server.ts";
export const userResource = remoteDataResource({
  key: userKey,
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.server.ts",
        root,
      ),
    ).rejects.toThrow(/cannot import "\.\/user\.keys\.server\.ts"/);
  });

  it("rejects remoteDataResource imports outside server modules", async () => {
    await expect(
      assertNoRemoteDataResourceImport(
        `import { remoteDataResource } from "@bgub/fig-start/server";
export const userResource = remoteDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.ts",
      ),
    ).rejects.toThrow(/remoteDataResource may only be imported/);
  });

  it("allows other fig-start server imports outside server modules", async () => {
    await expect(
      assertNoRemoteDataResourceImport(
        `import { createRequestHandler } from "@bgub/fig-start/server";
import type { remoteDataResource } from "@bgub/fig-start/server";
export const handler = createRequestHandler({ clientEntry: "/c.js", routes: [] });`,
        "/project/src/server.ts",
      ),
    ).resolves.toBeUndefined();
  });

  it("derives a stable id from root-relative path + export", () => {
    expect(clientRefId(rootRelative(root, "/project/src/a/B.tsx"), "B")).toBe(
      "/src/a/B.tsx#B",
    );
  });
});
