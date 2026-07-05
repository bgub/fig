import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  discoverServerDataResources,
  type ServerDataResourceRef,
} from "../../../fig-data/src/vite/index.ts";
import { type ClientRef, transformServerModule } from "./transform.ts";
import { rootRelative } from "./path-utils.ts";

export interface ServerRouteRef {
  id: string;
  specifier: string;
}

export async function collectClientRefs(root: string): Promise<ClientRef[]> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ClientRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const { clientRefs } = await transformServerModule(code, file, root);
    for (const ref of clientRefs) refs.set(ref.id, ref);
  }
  return [...refs.values()];
}

export async function collectServerRoutes(
  root: string,
): Promise<ServerRouteRef[]> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ServerRouteRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const result = await transformServerModule(code, file, root);
    if (result.serverRouteId !== null) {
      refs.set(result.serverRouteId, {
        id: result.serverRouteId,
        specifier: rootRelative(root, file),
      });
    }
  }
  return [...refs.values()];
}

export async function collectServerDataResources(
  root: string,
): Promise<ServerDataResourceRef[]> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ServerDataResourceRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const resources = await discoverServerDataResources(code, file, root);
    for (const ref of resources) refs.set(ref.id, ref);
  }
  return [...refs.values()];
}

async function findServerModules(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findServerModules(full)));
    } else if (
      entry.name.endsWith(".server.ts") ||
      entry.name.endsWith(".server.tsx")
    ) {
      files.push(full);
    }
  }
  return files;
}
