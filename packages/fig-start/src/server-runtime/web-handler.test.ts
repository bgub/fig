import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import type { ClientAssetResolver } from "../server-assets.ts";
import { createStartWebHandler } from "./web-handler.ts";

describe("createStartWebHandler", () => {
  it("does not consult client assets for non-asset route requests", async () => {
    const calls: string[] = [];
    const clientAssets: ClientAssetResolver = {
      resolve: async (url) => {
        calls.push(url);
        return null;
      },
    };
    const handle = createStartWebHandler({
      cacheClientAssets: false,
      clientAssets,
      handler: async () => new Response("route"),
    });

    const response = await handle(new Request("http://localhost/api/users"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("route");
    expect(calls).toEqual([]);
  });

  it("serves GET and HEAD requests for resolved client assets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fig-start-web-handler-"));
    const assetPath = join(dir, "client.js");
    await mkdir(dir, { recursive: true });
    await writeFile(assetPath, "export const value = 1;");

    const clientAssets: ClientAssetResolver = {
      resolve: async (url) =>
        url.endsWith("/client.js") ? pathToFileURL(assetPath) : null,
    };
    const handle = createStartWebHandler({
      cacheClientAssets: true,
      clientAssets,
      handler: async () => new Response("route"),
    });

    try {
      const getResponse = await handle(
        new Request("http://localhost/client.js"),
      );
      expect(getResponse.headers.get("cache-control")).toContain("immutable");
      expect(getResponse.headers.get("content-type")).toContain(
        "text/javascript",
      );
      expect(await getResponse.text()).toBe("export const value = 1;");

      const headResponse = await handle(
        new Request("http://localhost/client.js", { method: "HEAD" }),
      );
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe("");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("falls back to the route handler for unresolved or failing asset lookups", async () => {
    const clientAssets: ClientAssetResolver = {
      resolve: async () => {
        throw new Error("asset store unavailable");
      },
    };
    const handle = createStartWebHandler({
      cacheClientAssets: false,
      clientAssets,
      handler: async () => new Response("route"),
    });

    const response = await handle(new Request("http://localhost/client.js"));
    expect(await response.text()).toBe("route");
  });

  it("responds 404 for resolved assets that are missing on disk", async () => {
    const clientAssets: ClientAssetResolver = {
      resolve: async () => pathToFileURL("/nonexistent/client.js"),
    };
    const handle = createStartWebHandler({
      cacheClientAssets: false,
      clientAssets,
      handler: async () => new Response("route"),
    });

    const response = await handle(new Request("http://localhost/client.js"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("client bundle not built");
  });
});
