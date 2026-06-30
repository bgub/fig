import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { StartConfigError } from "./errors.ts";
import { normalizeStartRuntimeConfig } from "./config.ts";

describe("normalizeStartRuntimeConfig", () => {
  it("defaults to development mode and no client asset cache", async () => {
    const config = await Effect.runPromise(
      normalizeStartRuntimeConfig({
        appUrl: "file:///app/dist/server.js",
        env: {},
        root: "/app",
      }),
    );

    expect(config.mode).toBe("development");
    expect(config.port).toBe(3000);
    expect(config.clientEntry).toBe("/client.js");
    expect(config.cacheClientAssets).toBe(false);
    expect(config.publicUrl.href).toBe("http://localhost:3000/");
    expect(config.root).toBe("/app");
  });

  it("uses production cache policy from NODE_ENV", async () => {
    const config = await Effect.runPromise(
      normalizeStartRuntimeConfig({
        appUrl: "file:///app/dist/server.js",
        env: { NODE_ENV: "production", PORT: "4123" },
        root: "/app",
      }),
    );

    expect(config.mode).toBe("production");
    expect(config.port).toBe(4123);
    expect(config.cacheClientAssets).toBe(true);
  });

  it("lets explicit options override env defaults", async () => {
    const config = await Effect.runPromise(
      normalizeStartRuntimeConfig({
        appUrl: "file:///app/dist/server.js",
        cacheClientAssets: false,
        clientEntry: "/assets/client.js",
        env: { NODE_ENV: "production", PORT: "9999" },
        mode: "development",
        port: 5173,
        publicUrl: "https://fig-demo-start.localhost/",
        root: "/workspace/app",
      }),
    );

    expect(config.mode).toBe("development");
    expect(config.port).toBe(5173);
    expect(config.cacheClientAssets).toBe(false);
    expect(config.clientEntry).toBe("/assets/client.js");
    expect(config.publicUrl.href).toBe("https://fig-demo-start.localhost/");
    expect(config.root).toBe("/workspace/app");
  });

  it("fails on an invalid env port", async () => {
    const error = await Effect.runPromise(
      normalizeStartRuntimeConfig({
        appUrl: "file:///app/dist/server.js",
        env: { PORT: "nope" },
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(StartConfigError);
    expect(error.field).toBe("PORT");
  });

  it("fails on a relative app URL", async () => {
    const error = await Effect.runPromise(
      normalizeStartRuntimeConfig({
        appUrl: "./dist/server.js",
        env: {},
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(StartConfigError);
    expect(error.field).toBe("appUrl");
  });
});
