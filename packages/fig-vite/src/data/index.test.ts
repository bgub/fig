import { describe, expect, it } from "vitest";
import { figData } from "./index.ts";

describe("@bgub/fig/vite plugin", () => {
  it("stubs server data resources for client bundles", async () => {
    const plugin = figData();

    const result = await plugin.transform(
      `import { serverDataResource } from "@bgub/fig/server";
export const userResource = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
      "/project/src/data/user.server.ts",
    );

    expect(result?.code).toContain(
      "export const userResource = __figDataResource",
    );
    expect(result?.code).toContain('key: (id: string) => ["user", id]');
    expect(result?.code).not.toContain("load:");
  });

  it("leaves server builds unchanged", async () => {
    const plugin = figData();

    await expect(
      plugin.transform(
        `import { serverDataResource } from "@bgub/fig/server";`,
        "/project/src/data/user.server.ts",
        { ssr: true },
      ),
    ).resolves.toBeNull();
  });

  it("rejects server data resource imports outside server files", async () => {
    const plugin = figData();

    await expect(
      plugin.transform(
        `import { serverDataResource } from "@bgub/fig/server";
export const userResource = serverDataResource({
  key: (id: string) => ["user", id],
  load: async (id: string) => ({ id }),
});`,
        "/project/src/data/user.ts",
      ),
    ).rejects.toThrow(/serverDataResource may only be imported/);
  });
});
