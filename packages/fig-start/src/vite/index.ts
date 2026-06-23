import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ClientRef, transformServerModule } from "./transform.ts";

const MANIFEST_ID = "virtual:fig-start/client-manifest";
const RESOLVED_MANIFEST_ID = `\0${MANIFEST_ID}`;

export interface FigStartPlugin {
  configResolved(config: { root?: string }): void;
  enforce: "pre";
  load(id: string): Promise<string | null>;
  name: string;
  resolveId(id: string): string | null;
  transform(
    code: string,
    id: string,
  ): Promise<{ code: string; map: unknown } | null>;
}

// Vite plugin: rewrites `.tsx` imports inside `.server.tsx` modules into Fig
// client references, and serves a generated client manifest
// (`virtual:fig-start/client-manifest`) so the client resolves those ids back to
// modules. The manifest reuses the same transform, so ids always match.
export function figStart(): FigStartPlugin {
  let root = process.cwd();

  return {
    name: "fig-start",
    enforce: "pre",
    configResolved(config) {
      if (typeof config.root === "string") root = config.root;
    },
    resolveId(id) {
      return id === MANIFEST_ID ? RESOLVED_MANIFEST_ID : null;
    },
    async load(id) {
      return id === RESOLVED_MANIFEST_ID ? renderManifest(root) : null;
    },
    async transform(code, id) {
      const clean = id.split("?")[0] ?? id;
      if (!clean.endsWith(".server.tsx") || clean.includes("/node_modules/")) {
        return null;
      }
      const result = await transformServerModule(code, clean, root);
      if (result.clientRefs.length === 0) return null;
      return { code: result.code, map: result.map };
    },
  };
}

async function renderManifest(root: string): Promise<string> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ClientRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const { clientRefs } = await transformServerModule(code, file, root);
    for (const ref of clientRefs) refs.set(ref.id, ref);
  }

  const entries = [...refs.values()]
    .map(
      (ref) =>
        `  ${JSON.stringify(ref.id)}: () => import(${JSON.stringify(
          ref.specifier,
        )})`,
    )
    .join(",\n");

  return `const refs = {\n${entries}\n};
export function loadClientReference(metadata) {
  const load = refs[metadata.id];
  if (load === undefined) {
    throw new Error("Unknown client reference: " + metadata.id);
  }
  return load();
}
`;
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
    } else if (entry.name.endsWith(".server.tsx")) {
      files.push(full);
    }
  }
  return files;
}
