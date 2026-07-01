import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import type { ClientAssetResolver } from "../server-assets.ts";
import { createStartNodeRequestListener } from "./request-listener.ts";

describe("createStartNodeRequestListener", () => {
  it("does not consult client assets for non-asset route requests", async () => {
    const calls: string[] = [];
    const clientAssets: ClientAssetResolver = {
      resolve: async (url) => {
        calls.push(url);
        return null;
      },
    };
    const server = await listen(
      createServer(
        createStartNodeRequestListener({
          cacheClientAssets: false,
          clientAssets,
          handler: async () => new Response("route"),
        }),
      ),
    );

    try {
      const response = await fetch(serverUrl(server, "/api/users"));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("route");
      expect(calls).toEqual([]);
    } finally {
      await close(server);
    }
  });

  it("serves GET and HEAD requests for resolved client assets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fig-start-listener-"));
    const assetPath = join(dir, "client.js");
    await mkdir(dir, { recursive: true });
    await writeFile(assetPath, "export const value = 1;");

    const clientAssets: ClientAssetResolver = {
      resolve: async (url) =>
        url.endsWith("/client.js") ? pathToFileURL(assetPath) : null,
    };
    const server = await listen(
      createServer(
        createStartNodeRequestListener({
          cacheClientAssets: true,
          clientAssets,
          handler: async () => new Response("route"),
        }),
      ),
    );

    try {
      const getResponse = await fetch(serverUrl(server, "/client.js"));
      expect(getResponse.headers.get("cache-control")).toContain("immutable");
      expect(getResponse.headers.get("content-type")).toContain(
        "text/javascript",
      );
      expect(await getResponse.text()).toBe("export const value = 1;");

      const headResponse = await fetch(serverUrl(server, "/client.js"), {
        method: "HEAD",
      });
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe("");
    } finally {
      await close(server);
      await rm(dir, { force: true, recursive: true });
    }
  });
});

function listen(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function serverUrl(server: Server, pathname: string): string {
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected TCP server address.");
  }
  return `http://127.0.0.1:${address.port}${pathname}`;
}
