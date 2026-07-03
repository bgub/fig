import { createElement } from "@bgub/fig";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileRoute, createRootRoute } from "../route.ts";
import type { AnyRoute } from "../route.ts";

// Shared server test fixture: a temp app dir with built client/server stubs
// and a two-route tree whose rendered text is `${label} route`/`${label} home`.
export interface TestApp {
  appUrl: string;
  cleanup(): Promise<void>;
  root: string;
  routes: AnyRoute[];
}

export async function makeTestApp(label: string): Promise<TestApp> {
  const root = await mkdtemp(join(tmpdir(), "fig-start-test-app-"));
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
        component: () => createElement("main", null, `${label} route`),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, `${label} home`),
      }),
    ],
  };
}

export function serverPort(server: Server): number {
  const address = server.address();
  if (typeof address === "object" && address !== null) return address.port;
  throw new Error("Expected TCP server address.");
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
