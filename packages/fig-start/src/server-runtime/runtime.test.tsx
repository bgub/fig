import { createElement } from "@bgub/fig";
import { Effect } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createFileRoute, createRootRoute } from "../route.ts";
import type { AnyRoute } from "../route.ts";
import { StartConfigError, StartListenError } from "./errors.ts";
import { closeNodeHttpServer } from "./node-http.ts";
import { runStartRuntime, startRuntimeLayer } from "./runtime.ts";

interface TestApp {
  appUrl: string;
  cleanup(): Promise<void>;
  root: string;
  routes: AnyRoute[];
}

async function makeTestApp(): Promise<TestApp> {
  const root = await mkdtemp(join(tmpdir(), "fig-start-runtime-"));
  const dist = join(root, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "client.js"), "export const ok = true;\n");
  await writeFile(join(dist, "server.js"), "export {};\n");

  return {
    appUrl: pathToFileURL(join(dist, "server.js")).href,
    cleanup: () => rm(root, { force: true, recursive: true }),
    root,
    routes: [
      createRootRoute({
        component: () => createElement("main", null, "Runtime route"),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Runtime home"),
      }),
    ],
  };
}

function serverPort(server: { address(): unknown }): number {
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected TCP server address.");
  }
  return (address as { port: number }).port;
}

describe("start runtime", () => {
  it("boots production mode through the shared layers", async () => {
    const app = await makeTestApp();
    const logs: string[] = [];
    const server = await runStartRuntime(
      startRuntimeLayer({
        config: {
          appUrl: app.appUrl,
          env: {},
          mode: "production",
          port: 0,
          publicUrl: "https://fig.example/",
        },
        handlerOptions: { routes: app.routes },
        log: (message) => logs.push(message),
      }),
    );

    try {
      const port = serverPort(server);
      const asset = await fetch(`http://127.0.0.1:${port}/client.js`);
      const page = await fetch(`http://127.0.0.1:${port}/`);

      expect(asset.status).toBe(200);
      // Production defaults (immutable asset caching) flow through the same
      // layer path the dev server uses.
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(page.status).toBe(200);
      await expect(page.text()).resolves.toContain("Runtime route");
      expect(logs).toEqual(["Fig Start: https://fig.example/"]);
    } finally {
      await Effect.runPromise(closeNodeHttpServer(server));
      await app.cleanup();
    }
  });

  it("rejects with StartConfigError for invalid config", async () => {
    const rejection = runStartRuntime(
      startRuntimeLayer({
        config: { appUrl: "not-an-absolute-url", env: {} },
        handlerOptions: { routes: [] },
        log: () => undefined,
      }),
    );

    await expect(rejection).rejects.toBeInstanceOf(StartConfigError);
    await expect(rejection).rejects.toMatchObject({ field: "appUrl" });
  });

  it("rejects with StartListenError when the port is taken", async () => {
    const app = await makeTestApp();
    const layerFor = (port: number) =>
      startRuntimeLayer({
        config: { appUrl: app.appUrl, env: {}, port },
        handlerOptions: { routes: app.routes },
        log: () => undefined,
      });

    const first = await runStartRuntime(layerFor(0));
    try {
      const rejection = runStartRuntime(layerFor(serverPort(first)));
      await expect(rejection).rejects.toBeInstanceOf(StartListenError);
      await expect(rejection).rejects.toMatchObject({
        port: serverPort(first),
      });
    } finally {
      await Effect.runPromise(closeNodeHttpServer(first));
      await app.cleanup();
    }
  });

  it("releases shutdown-signal listeners when the server closes externally", async () => {
    const app = await makeTestApp();
    const before = process.listenerCount("SIGINT");

    const server = await runStartRuntime(
      startRuntimeLayer({
        config: { appUrl: app.appUrl, env: {}, port: 0 },
        handlerOptions: { routes: app.routes },
        log: () => undefined,
      }),
    );

    try {
      expect(process.listenerCount("SIGINT")).toBe(before + 1);

      await Effect.runPromise(closeNodeHttpServer(server));
      // The close event completes the scoped program, which interrupts the
      // signal wait and detaches its process listeners.
      for (let i = 0; i < 20; i += 1) {
        if (process.listenerCount("SIGINT") === before) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      await app.cleanup();
    }
  });
});
