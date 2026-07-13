import { describe, expect, it } from "vitest";
import { startDevServer } from "./dev-server.ts";
import {
  closeServer,
  makeTestApp,
  serverPort,
} from "./server-runtime/test-app.ts";

describe("startDevServer", () => {
  it("serves client assets and routes in development mode", async () => {
    const app = await makeTestApp("Dev");
    const logs: string[] = [];
    const server = await startDevServer({
      appUrl: app.appUrl,
      env: {},
      log: (message) => logs.push(message),
      port: 0,
      publicUrl: "https://fig-demo-start.localhost/",
      root: app.root,
      routes: app.routes,
    });

    try {
      const port = serverPort(server);
      const asset = await fetch(`http://127.0.0.1:${port}/client.js`);
      const page = await fetch(`http://127.0.0.1:${port}/`);

      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("no-store");
      await expect(asset.text()).resolves.toContain("ok = true");
      expect(page.status).toBe(200);
      await expect(page.text()).resolves.toContain("Dev route");
      expect(logs).toEqual([
        "Fig Start dev server: https://fig-demo-start.localhost/",
      ]);
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });
});

describe("linkedDistsChangedSinceLastRun", () => {
  it("forces re-optimization only when a linked dist changes between runs", async () => {
    const { mkdtemp, mkdir, rm, symlink, utimes, writeFile } =
      await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { linkedDistsChangedSinceLastRun } =
      await import("./dev-server/vite-runtime.ts");

    const base = await mkdtemp(join(tmpdir(), "fig-linked-dists-"));
    try {
      // A workspace-shaped fixture: a linked package with a dist, an app
      // whose node_modules symlinks it, and a cache dir for the marker.
      const pkg = join(base, "packages", "fig");
      await mkdir(join(pkg, "dist"), { recursive: true });
      await writeFile(join(pkg, "dist", "index.js"), "export {};\n");
      const app = join(base, "app");
      await mkdir(join(app, "node_modules", "@bgub"), { recursive: true });
      await symlink(pkg, join(app, "node_modules", "@bgub", "fig"), "dir");
      const cacheDir = join(app, "node_modules", ".vite");
      const logs: string[] = [];
      const log = (message: string) => logs.push(message);

      // First run: no previous marker — record, do not force.
      expect(await linkedDistsChangedSinceLastRun(app, cacheDir, log)).toBe(
        false,
      );
      // Unchanged dists: cached prebundles stay valid.
      expect(await linkedDistsChangedSinceLastRun(app, cacheDir, log)).toBe(
        false,
      );
      expect(logs).toEqual([]);

      // A rebuild (new mtime) between runs forces one re-optimization…
      const bumped = new Date(Date.now() + 5_000);
      await utimes(join(pkg, "dist", "index.js"), bumped, bumped);
      expect(await linkedDistsChangedSinceLastRun(app, cacheDir, log)).toBe(
        true,
      );
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("re-optimizing prebundled dependencies");

      // …and only one: the marker now matches again.
      expect(await linkedDistsChangedSinceLastRun(app, cacheDir, log)).toBe(
        false,
      );
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
});
