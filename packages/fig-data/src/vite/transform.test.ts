import { describe, expect, it } from "vite-plus/test";
import {
  dataResourceId,
  discoverServerDataResources,
  rootRelative,
  transformServerDataClientStub,
} from "./transform.ts";

const root = "/project";

describe("@bgub/fig-data/vite transform", () => {
  it("stubs server-only data resources as hydrate-only browser resources", async () => {
    const out = await transformServerDataClientStub(
      `import { serverDataResource } from "@bgub/fig-data/server";
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
    expect(out.code).not.toContain("__figDataResource.remote");
    expect(out.code).toContain('key: (id: string) => ["user", id]');
    expect(out.code).not.toContain("db.user");
  });

  it("stubs remote server data resources as remote browser resources", async () => {
    const out = await transformServerDataClientStub(
      `import { serverDataResource } from "@bgub/fig-data/server";
import { db } from "./db.server.ts";
export const userResource = serverDataResource({
  remote: true,
  key: (id: string) => ["user", id],
  load: async (id: string) => db.user(id),
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(out.stubs).toHaveLength(1);
    expect(out.code).toContain("__figDataResource.remote");
    expect(out.code).toContain('id: "/src/data/user.server.ts#userResource"');
    expect(out.code).toContain('key: (id: string) => ["user", id]');
    expect(out.code).not.toContain("db.user");
  });

  it("discovers only remote resources for endpoint registration", async () => {
    const resources = await discoverServerDataResources(
      `import { serverDataResource } from "@bgub/fig-data/server";
export const localResource = serverDataResource({
  key: () => ["local"],
  load: () => "local",
});
export const remoteResource = serverDataResource({
  remote: true,
  key: () => ["remote"],
  load: () => "remote",
});`,
      "/project/src/data/user.server.ts",
      root,
    );

    expect(resources).toEqual([
      {
        exportName: "remoteResource",
        id: "/src/data/user.server.ts#remoteResource",
        specifier: "/src/data/user.server.ts",
      },
    ]);
  });

  it("preserves shared imports referenced by browser stubs", async () => {
    const out = await transformServerDataClientStub(
      `import { serverDataResource } from "@bgub/fig-data/server";
import { userKey as keyForUser } from "./user.keys.ts";
import { db } from "./db.server.ts";
export const userResource = serverDataResource({
  remote: true,
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
        `import { serverDataResource } from "@bgub/fig-data/server";
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

  it("rejects non-literal remote options", async () => {
    await expect(
      transformServerDataClientStub(
        `import { serverDataResource } from "@bgub/fig-data/server";
const isRemote = true;
export const userResource = serverDataResource({
  remote: isRemote,
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.server.ts",
        root,
      ),
    ).rejects.toThrow(/must use remote: true/);
  });

  it("derives stable ids from root-relative path and export", () => {
    expect(
      dataResourceId(rootRelative(root, "/project/src/a/b.ts"), "user"),
    ).toBe("/src/a/b.ts#user");
  });
});
