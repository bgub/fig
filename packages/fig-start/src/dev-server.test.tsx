import { createElement } from "@bgub/fig";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createFileRoute, createRootRoute } from "./route.ts";
import { closeNodeHttpServer } from "./server-runtime/node-http.ts";
import { startDevServer } from "./dev-server.ts";

describe("startDevServer", () => {
  it("serves client assets and routes in development mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-start-dev-server-"));
    const dist = join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "client.js"), "export const ok = true;\n");
    await writeFile(join(dist, "server.js"), "export {};\n");

    const rootRoute = createRootRoute({
      component: () => createElement("main", null, "Dev route"),
    });
    const indexRoute = createFileRoute("/")({
      component: () => createElement("h1", null, "Dev home"),
    });
    const logs: string[] = [];
    const server = await startDevServer({
      appUrl: pathToFileURL(join(dist, "server.js")).href,
      env: {},
      log: (message) => logs.push(message),
      port: 0,
      publicUrl: "https://fig-demo-start.localhost/",
      root,
      routes: [rootRoute, indexRoute],
    });

    try {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Expected TCP server address.");
      }

      const asset = await fetch(`http://127.0.0.1:${address.port}/client.js`);
      const page = await fetch(`http://127.0.0.1:${address.port}/`);

      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("no-store");
      await expect(asset.text()).resolves.toContain("ok = true");
      expect(page.status).toBe(200);
      await expect(page.text()).resolves.toContain("Dev route");
      expect(logs).toEqual([
        "Fig Start dev server: https://fig-demo-start.localhost/",
      ]);
    } finally {
      await Effect.runPromise(closeNodeHttpServer(server));
      await rm(root, { force: true, recursive: true });
    }
  });
});
