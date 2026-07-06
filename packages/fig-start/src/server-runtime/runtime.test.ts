import { describe, expect, it } from "vite-plus/test";
import { DATA_ENDPOINT_PATH } from "../bootstrap.ts";
import { StartConfigError, StartListenError } from "./errors.ts";
import { remoteDataResource } from "../server.ts";
import { runStartRuntime } from "./runtime.ts";
import { closeServer, makeTestApp, serverPort } from "./test-app.ts";

describe("start runtime", () => {
  it("boots production mode through the shared runtime", async () => {
    const app = await makeTestApp("Runtime");
    const logs: string[] = [];
    const server = await runStartRuntime({
      config: {
        appUrl: app.appUrl,
        env: {},
        mode: "production",
        port: 0,
        publicUrl: "https://fig.example/",
      },
      handlerOptions: { routes: app.routes },
      log: (message) => logs.push(message),
    });

    try {
      const port = serverPort(server);
      const asset = await fetch(`http://127.0.0.1:${port}/client.js`);
      const page = await fetch(`http://127.0.0.1:${port}/`);

      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(page.status).toBe(200);
      await expect(page.text()).resolves.toContain("Runtime route");
      expect(logs).toEqual(["Fig Start: https://fig.example/"]);
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("forwards request bodies to the web handler", async () => {
    const app = await makeTestApp("Runtime");
    const resource = remoteDataResource({
      key: (id: string) => ["runtime-body", id],
      load: async (id: string) => `body-${id}`,
    });
    const server = await runStartRuntime({
      config: {
        appUrl: app.appUrl,
        env: {},
        mode: "production",
        port: 0,
      },
      handlerOptions: {
        routes: app.routes,
        serverDataResources: { "test#resource": resource },
      },
      log: () => undefined,
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${serverPort(server)}${DATA_ENDPOINT_PATH}`,
        {
          body: JSON.stringify({ args: ["ok"], id: "test#resource" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        key: ["runtime-body", "ok"],
        value: "body-ok",
      });
    } finally {
      await closeServer(server);
      await app.cleanup();
    }
  });

  it("rejects with StartConfigError for invalid config", async () => {
    const rejection = runStartRuntime({
      config: { appUrl: "not-an-absolute-url", env: {} },
      handlerOptions: { routes: [] },
      log: () => undefined,
    });

    await expect(rejection).rejects.toBeInstanceOf(StartConfigError);
    await expect(rejection).rejects.toMatchObject({ field: "appUrl" });
  });

  it("rejects with StartListenError when the port is taken", async () => {
    const app = await makeTestApp("Runtime");
    const inputFor = (port: number) => ({
      config: { appUrl: app.appUrl, env: {}, port },
      handlerOptions: { routes: app.routes },
      log: () => undefined,
    });

    const first = await runStartRuntime(inputFor(0));
    try {
      const rejection = runStartRuntime(inputFor(serverPort(first)));
      await expect(rejection).rejects.toBeInstanceOf(StartListenError);
      await expect(rejection).rejects.toMatchObject({
        port: serverPort(first),
      });
    } finally {
      await closeServer(first);
      await app.cleanup();
    }
  });

  it("releases shutdown-signal listeners when the server closes externally", async () => {
    const app = await makeTestApp("Runtime");
    const before = process.listenerCount("SIGINT");

    const server = await runStartRuntime({
      config: { appUrl: app.appUrl, env: {}, port: 0 },
      handlerOptions: { routes: app.routes },
      log: () => undefined,
    });

    try {
      expect(process.listenerCount("SIGINT")).toBe(before + 1);

      await closeServer(server);
      // The close event completes the scoped program, which interrupts the
      // NodeRuntime main fiber and detaches its process listeners.
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
