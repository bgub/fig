import { describe, expect, it } from "vite-plus/test";
import {
  clientRefId,
  rootRelative,
  transformServerModule,
} from "./transform.ts";

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
    expect(out.code).toContain("clientReference as __figClientRef");
    expect(out.code).toContain("__figClientRef(");
    expect(out.code).toContain('"/src/routes/Island.tsx#Island"');
    // the original import binding is gone (the island never enters the graph here)
    expect(out.code).not.toContain('from "./Island.tsx"');
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
      `import { readData } from "@bgub/fig-data";\nexport function X(){ return null; }`,
      "/project/src/x.server.tsx",
      root,
    );
    expect(out.clientRefs).toEqual([]);
    expect(out.code).not.toContain("__figClientRef");
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

  it("derives a stable id from root-relative path + export", () => {
    expect(clientRefId(rootRelative(root, "/project/src/a/B.tsx"), "B")).toBe(
      "/src/a/B.tsx#B",
    );
  });
});
