import { describe, expect, it } from "vite-plus/test";
import {
  closeServer,
  makeTestApp,
  serverPort,
} from "./server-runtime/test-app.ts";
import { startDevServer } from "./dev-server.ts";

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
