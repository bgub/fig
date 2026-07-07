import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { closeServer, serverPort } from "../server-runtime/test-app.ts";
import { staticAssetHref } from "../vite/static-assets.ts";
import { devHotUpdateForFile, startViteDevServer } from "./vite-runtime.ts";

describe("startViteDevServer", () => {
  it("serves Vite HMR from the Fig Start HTTP server", async () => {
    const app = await makeViteAppRoot();
    const server = await startViteDevServer({
      log: () => {},
      port: 0,
      root: app.root,
    });

    try {
      const port = serverPort(server);
      const client = await viteClientSource(port);

      expect(client).not.toContain("24678");
      expect(client).toContain("const hmrPort = null;");
      await expect(openHmrSocket(port, viteWsToken(client))).resolves.toBe(
        undefined,
      );
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("uses the public URL origin for Vite HMR clients", async () => {
    const app = await makeViteAppRoot();
    const server = await startViteDevServer({
      log: () => {},
      port: 0,
      publicUrl: "https://fig-demo-start.localhost/",
      root: app.root,
    });

    try {
      const client = await viteClientSource(serverPort(server));

      expect(client).not.toContain("24678");
      expect(client).toContain('const socketProtocol = "wss"');
      expect(client).toContain("const hmrPort = 443;");
      expect(client).toContain(
        '"fig-demo-start.localhost" || importMetaUrl.hostname',
      );
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("adds Fig refresh boundaries to client component modules", async () => {
    const app = await makeViteRefreshAppRoot();
    const server = await startViteDevServer({
      log: () => {},
      port: 0,
      root: app.root,
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${serverPort(server)}/src/components/Counter.tsx`,
      );

      const code = await response.text();
      expect(
        response.status,
        `Expected transformed module, received:\n${code}`,
      ).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/javascript; charset=utf-8",
      );
      expect(code).toContain("virtual:fig-refresh");
      expect(code).toContain("src/components/Counter.tsx#Counter");
      expect(code).toContain("import.meta.hot.accept();");
      expect(code).toContain("__figRefresh();");
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("serves raw and imported source assets with the correct MIME types", async () => {
    const app = await makeViteAssetAppRoot();
    const server = await startViteDevServer({
      log: () => {},
      port: 0,
      root: app.root,
    });

    try {
      const port = serverPort(server);
      const rawAsset = await fetch(
        `http://127.0.0.1:${port}/src/components/client-mark.svg`,
      );
      const importedAsset = await fetch(
        `http://127.0.0.1:${port}/src/components/client-mark.svg?import`,
      );
      const generatedAsset = await fetch(
        `http://127.0.0.1:${port}${staticAssetHref(app.root, app.assetFile)}`,
      );

      expect(rawAsset.status).toBe(200);
      expect(rawAsset.headers.get("content-type")).toBe("image/svg+xml");
      await expect(rawAsset.text()).resolves.toContain("<svg");

      expect(importedAsset.status).toBe(200);
      expect(importedAsset.headers.get("content-type")).toBe(
        "text/javascript; charset=utf-8",
      );
      await expect(importedAsset.text()).resolves.toBe(
        `export default ${JSON.stringify(staticAssetHref(app.root, app.assetFile))};\n`,
      );

      expect(generatedAsset.status).toBe(200);
      expect(generatedAsset.headers.get("content-type")).toBe("image/svg+xml");
      await expect(generatedAsset.text()).resolves.toContain("<svg");
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("classifies server-side source changes for dev HMR", async () => {
    const app = await makeViteAppRoot();

    try {
      expect(
        devHotUpdateForFile(
          app.root,
          join(app.root, "src", "routes", "index.server.tsx"),
        ),
      ).toEqual({
        action: "server-update",
        message: {
          kind: "server",
          path: "/src/routes/index.server.tsx",
        },
      });
      expect(
        devHotUpdateForFile(app.root, join(app.root, "src", "start.tsx")),
      ).toEqual({ action: "full-reload" });
      expect(
        devHotUpdateForFile(app.root, join(app.root, "src", "routes.ts")),
      ).toEqual({ action: "full-reload" });
      expect(
        devHotUpdateForFile(
          app.root,
          join(app.root, "src", "components", "Counter.tsx"),
        ),
      ).toBeNull();
    } finally {
      await app.cleanup();
    }
  });
});

async function makeViteAppRoot(): Promise<{
  cleanup: () => Promise<void>;
  root: string;
}> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-fig-start-vite-test-"));
  return {
    cleanup: () => rm(root, { force: true, recursive: true }),
    root,
  };
}

async function makeViteRefreshAppRoot(): Promise<{
  cleanup: () => Promise<void>;
  root: string;
}> {
  const app = await makeViteAppRoot();
  const components = join(app.root, "src", "components");
  await mkdir(components, { recursive: true });
  await writeFile(
    join(components, "Counter.tsx"),
    `export function Counter() {
  return "count";
}
`,
  );
  return app;
}

async function makeViteAssetAppRoot(): Promise<{
  assetFile: string;
  cleanup: () => Promise<void>;
  root: string;
}> {
  const app = await makeViteAppRoot();
  const components = join(app.root, "src", "components");
  const assetFile = join(components, "client-mark.svg");
  await mkdir(components, { recursive: true });
  await writeFile(
    assetFile,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n`,
  );
  return { ...app, assetFile };
}

async function viteClientSource(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/@vite/client`);
  expect(response.status).toBe(200);
  return response.text();
}

function viteWsToken(clientSource: string): string {
  const match = /const wsToken = "([^"]+)";/.exec(clientSource);
  if (match === null) throw new Error("Expected Vite client WS token.");
  return match[1];
}

function openHmrSocket(port: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/?token=${token}`,
      "vite-hmr",
    );
    const timeout = setTimeout(() => {
      finish(new Error("Timed out opening Vite HMR socket."));
    }, 2_000);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (error === undefined) resolve();
      else reject(error);
    }

    socket.addEventListener(
      "message",
      (event) => {
        if (event.data !== JSON.stringify({ type: "connected" })) {
          finish(new Error(`Unexpected Vite HMR message: ${event.data}`));
          return;
        }
        setTimeout(() => finish(), 100);
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => finish(new Error("Vite HMR socket closed early.")),
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => finish(new Error("Failed to open Vite HMR socket.")),
      { once: true },
    );
  });
}
