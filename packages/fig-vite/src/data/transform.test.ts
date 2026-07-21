import { describe, expect, it } from "vitest";
import {
  collectServerDataResourceStubs,
  dataResourceId,
  discoverServerDataResources,
  rootRelative,
  transformServerDataClientStub,
} from "./transform.ts";

const root = "/project";

describe("@bgub/fig/vite transform", () => {
  it("stubs server-only data resources as hydrate-only browser resources", async () => {
    const out = await transformServerDataClientStub(
      `import { serverDataResource } from "@bgub/fig/server";
import { db } from "./db.server.ts";
export const userResource = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => db.user(id),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.stubs).toHaveLength(1);
    expect(out.code).toContain("dataResource as __figDataResource");
    expect(out.code).toContain("export const userResource = __figDataResource");
    expect(out.code).not.toContain("load:");
    expect(out.code).toContain('key: (id: string) => ["user", id]');
    expect(out.code).not.toContain("db.user");
  });

  it("collects browser-safe server resource stubs", async () => {
    const stubs = await collectServerDataResourceStubs(
      `import { serverDataResource } from "@bgub/fig/server";
import { db } from "./db.server.ts";
export const userResource = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => db.user(id),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(stubs).toEqual([
      {
        debugArgsCode: undefined,
        exportName: "userResource",
        id: "/src/data/user.server.ts#userResource",
        importCodes: [],
        keyCode: '(id: string) => ["user", id]',
      },
    ]);
  });

  it("discovers exported server data resource declarations", async () => {
    const code = `import { serverDataResource } from "@bgub/fig/server";
export const localResource = serverDataResource({
  key: () => ["local"],
  load: () => "local",
});
export const unrelated = dataResource({
  key: () => ["unrelated"],
  load: () => "unrelated",
});`;

    await expect(
      discoverServerDataResources(
        code,
        "/project/src/data/user.server.ts",
        root,
      ),
    ).resolves.toEqual([
      {
        exportName: "localResource",
        id: "/src/data/user.server.ts#localResource",
        specifier: "/src/data/user.server.ts",
      },
    ]);
  });

  it("preserves shared imports referenced by browser stubs", async () => {
    const out = await transformServerDataClientStub(
      `import { serverDataResource } from "@bgub/fig/server";
import { userKey as keyForUser } from "./user.keys.ts";
import { db } from "./db.server.ts";
export const userResource = serverDataResource({
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

  it("rejects stubs that reference server-only imports", async () => {
    await expect(
      transformServerDataClientStub(
        `import { serverDataResource } from "@bgub/fig/server";
import { userKey } from "./user.keys.server.ts";
export const userResource = serverDataResource({
  key: userKey,
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.server.ts",
        root,
      ),
    ).rejects.toThrow(/cannot import "\.\/user\.keys\.server\.ts"/);
  });

  it("rejects exported isomorphic dataResource declarations", async () => {
    await expect(
      transformServerDataClientStub(
        `import { dataResource } from "@bgub/fig";
export const userResource = dataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.server.ts",
        root,
      ),
    ).rejects.toThrow(/cannot be exported from a \.server module/);
  });

  it("derives stable ids from root-relative path and export", () => {
    expect(
      dataResourceId(rootRelative(root, "/project/src/a/b.ts"), "user"),
    ).toBe("/src/a/b.ts#user");
  });
});
