import { describe, expect, it } from "vite-plus/test";
import { figStart } from "./index.ts";

describe("@bgub/fig-start/vite plugin", () => {
  it("serves generated client and server entries", async () => {
    const plugin = figStart();
    const clientId = plugin.resolveId("virtual:fig-start/client-entry");
    const serverId = plugin.resolveId("virtual:fig-start/server-entry");

    expect(clientId).toBe("\0virtual:fig-start/client-entry");
    expect(serverId).toBe("\0virtual:fig-start/server-entry");
    await expect(plugin.load(clientId ?? "")).resolves.toBe(
      `import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

hydrateStart({
  context: { appName: start.appName },
  loadClientReference,
  onRecoverableError: start.onRecoverableError,
  routes: start.routes,
});
`,
    );
    await expect(plugin.load(serverId ?? "")).resolves.toBe(
      `import { startServer } from "@bgub/fig-start/server";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

startServer({
  ...serverOptions,
  appUrl: import.meta.url,
  context: () => ({ appName }),
});
`,
    );
  });

  it("resolves root-relative imports from generated virtual modules", () => {
    const plugin = figStart();
    plugin.configResolved({ root: "/project" });

    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/client-entry"),
    ).toBe("/project/src/start.tsx");
    expect(
      plugin.resolveId("/src/start.tsx", "\0virtual:fig-start/server-entry"),
    ).toBe("/project/src/start.tsx");
  });
});
