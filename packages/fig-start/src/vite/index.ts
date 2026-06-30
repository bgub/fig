import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type ClientRef,
  transformServerModule,
  transformServerRouteClientStub,
} from "./transform.ts";

const MANIFEST_ID = "virtual:fig-start/client-manifest";
const SERVER_MANIFEST_ID = "virtual:fig-start/server-manifest";
const CLIENT_ENTRY_ID = "virtual:fig-start/client-entry";
const SERVER_ENTRY_ID = "virtual:fig-start/server-entry";
const DEV_ENV_ID = "virtual:fig-start/dev-env";
const CLIENT_ASSET_MANIFEST_FILE = "fig-start-client-assets.json";
const ROOT_RELATIVE_VIRTUAL_IDS = [
  MANIFEST_ID,
  CLIENT_ENTRY_ID,
  SERVER_ENTRY_ID,
  SERVER_MANIFEST_ID,
] as const;

export interface FigStartPlugin {
  configResolved(config: { root?: string }): void;
  enforce: "pre";
  load(id: string): Promise<string | null>;
  name: string;
  resolveId(id: string, importer?: string): string | null;
  transform(
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ): Promise<{ code: string; map: unknown } | null>;
  writeBundle?(options: OutputOptions, bundle: OutputBundle): Promise<void>;
}

export interface FigStartPluginOptions {
  clientNodeEnv?: "development" | "production";
  target?: "auto" | "client" | "server";
  tailwind?: boolean | { base?: string };
}

type OutputBundle = Record<string, OutputAsset | OutputChunk>;

interface OutputOptions {
  dir?: string;
  file?: string;
}

interface OutputAsset {
  fileName: string;
  source?: unknown;
  type: "asset";
}

interface OutputChunk {
  facadeModuleId?: string | null;
  fileName: string;
  moduleIds?: string[];
  type: "chunk";
  viteMetadata?: {
    importedCss?: Iterable<string>;
  };
}

interface ClientAssetManifestEntry {
  css?: string[];
  module?: string;
}

type ClientAssetManifest = Record<string, ClientAssetManifestEntry>;

// Vite plugin: rewrites `.tsx` imports inside `.server.tsx` modules into Fig
// client references, and serves a generated client manifest
// (`virtual:fig-start/client-manifest`) so the client resolves those ids back to
// modules. The manifest reuses the same transform, so ids always match.
export function figStart(options: FigStartPluginOptions = {}): FigStartPlugin {
  let root = process.cwd();
  const clientNodeEnv = options.clientNodeEnv;
  const tailwind = options.tailwind ?? false;
  const target = options.target ?? "auto";
  const rootRelativeImporters = new Set(
    ROOT_RELATIVE_VIRTUAL_IDS.map(resolvedVirtualId),
  );
  const virtualModules: Record<string, () => string | Promise<string>> = {
    [MANIFEST_ID]: () => renderManifest(root),
    [SERVER_MANIFEST_ID]: () => renderServerManifest(root),
    [CLIENT_ENTRY_ID]: () => renderClientEntry(clientNodeEnv),
    [SERVER_ENTRY_ID]: () => renderServerEntry(),
    [DEV_ENV_ID]: () => renderDevEnv(clientNodeEnv),
  };

  return {
    name: "fig-start",
    enforce: "pre",
    configResolved(config) {
      if (typeof config.root === "string") root = config.root;
    },
    async writeBundle(options, bundle) {
      if (target !== "client") return;
      const manifestPath = join(
        outputDirectory(root, options),
        CLIENT_ASSET_MANIFEST_FILE,
      );
      await writeFile(
        manifestPath,
        JSON.stringify(await renderClientAssetManifest(root, bundle)),
      );
    },
    resolveId(id, importer) {
      if (id in virtualModules) return resolvedVirtualId(id);
      if (
        importer !== undefined &&
        rootRelativeImporters.has(importer) &&
        id.startsWith("/") &&
        !id.includes("?")
      ) {
        return resolve(root, id.slice(1));
      }
      return null;
    },
    async load(id) {
      const render = id.startsWith("\0")
        ? virtualModules[id.slice(1)]
        : undefined;
      if (render !== undefined) return render();
      return null;
    },
    async transform(code, id, options) {
      const clean = id.split("?")[0] ?? id;
      if (tailwind !== false && isCssId(clean) && isTailwindCssEntry(code)) {
        return transformTailwindCss(code, clean, root, tailwind);
      }

      if (!clean.endsWith(".server.tsx") || clean.includes("/node_modules/")) {
        return null;
      }
      if (transformTarget(target, options) === "client") {
        const result = await transformServerRouteClientStub(code, clean);
        return { code: result.code, map: result.map };
      }

      const result = await transformServerModule(code, clean, root);
      if (result.clientRefs.length === 0 && !result.marksServerRoute) {
        return null;
      }
      return { code: result.code, map: result.map };
    },
  };
}

function isCssId(id: string): boolean {
  return id.endsWith(".css");
}

function resolvedVirtualId(id: string): string {
  return `\0${id}`;
}

function transformTarget(
  target: NonNullable<FigStartPluginOptions["target"]>,
  options: { ssr?: boolean } | undefined,
): "client" | "server" {
  if (target !== "auto") return target;
  return options?.ssr === true ? "server" : "client";
}

async function renderManifest(root: string): Promise<string> {
  const refs = await collectClientRefs(root);
  const entries = refs
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

async function renderServerManifest(root: string): Promise<string> {
  const refs = await collectClientRefs(root);
  const entries = refs
    .map(
      (ref) =>
        `  ${JSON.stringify(ref.id)}: { css: [], module: ${JSON.stringify(
          ref.specifier,
        )} }`,
    )
    .join(",\n");

  return `import { readFileSync } from "node:fs";
import { modulepreload, stylesheet } from "@bgub/fig";

const refs = {\n${entries}\n};
let clientAssetManifest;

function readClientAssetManifest() {
  if (clientAssetManifest !== undefined) return clientAssetManifest;
  try {
    clientAssetManifest = JSON.parse(readFileSync(new URL(${JSON.stringify(
      `./${CLIENT_ASSET_MANIFEST_FILE}`,
    )}, import.meta.url), "utf8"));
  } catch (error) {
    console.warn(
      "[fig-start] Client asset manifest is unavailable; falling back to source-specifier client-reference assets.",
      error,
    );
    clientAssetManifest = {};
  }
  return clientAssetManifest;
}

export function resolveClientReferenceAssets(metadata) {
  const ref = refs[metadata.id];
  if (ref === undefined) return [];
  const built = readClientAssetManifest()[metadata.id] ?? {};
  const css = built.css ?? ref.css;
  const module = built.module ?? ref.module;
  return [
    ...css.map((href) => stylesheet(href)),
    modulepreload(module),
  ];
}
`;
}

async function collectClientRefs(root: string): Promise<ClientRef[]> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ClientRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const { clientRefs } = await transformServerModule(code, file, root);
    for (const ref of clientRefs) refs.set(ref.id, ref);
  }
  return [...refs.values()];
}

async function transformTailwindCss(
  code: string,
  id: string,
  root: string,
  options: Exclude<FigStartPluginOptions["tailwind"], false | undefined>,
): Promise<{ code: string; map: unknown }> {
  const [{ default: postcss }, { default: tailwindcss }] = await Promise.all([
    import("postcss"),
    import("@tailwindcss/postcss"),
  ]);
  const base = typeof options === "object" ? options.base : undefined;
  const result = await postcss([
    tailwindcss({ base: base ?? root }),
  ]).process(code, {
    from: id,
    map: { annotation: false, inline: false },
    to: id,
  });
  return { code: result.css, map: result.map?.toJSON() ?? null };
}

function isTailwindCssEntry(code: string): boolean {
  return /@import\s+["']tailwindcss["']|@tailwind\b/.test(code);
}

async function renderClientAssetManifest(
  root: string,
  bundle: OutputBundle,
): Promise<ClientAssetManifest> {
  const refs = await collectClientRefs(root);
  const manifest: ClientAssetManifest = {};

  for (const ref of refs) {
    const chunk = outputChunkForModule(
      bundle,
      rootAbsolutePath(root, ref.specifier),
    );
    const entry: ClientAssetManifestEntry = {};
    if (chunk !== null) entry.module = outputHref(chunk.fileName);
    const css = chunk === null ? [] : outputCssHrefsForChunk(chunk);
    if (css.length > 0) entry.css = css;
    manifest[ref.id] = entry;
  }

  return manifest;
}

function outputCssHrefsForChunk(chunk: OutputChunk): string[] {
  return [...(chunk.viteMetadata?.importedCss ?? [])]
    .filter((fileName) => fileName.endsWith(".css"))
    .map(outputHref);
}

function outputChunkForModule(
  bundle: OutputBundle,
  modulePath: string,
): OutputChunk | null {
  const normalized = normalizePath(modulePath);
  for (const file of Object.values(bundle)) {
    if (file.type !== "chunk") continue;
    const ids = file.moduleIds ?? [];
    if (ids.some((id) => normalizePath(id) === normalized)) return file;
    if (
      file.facadeModuleId !== undefined &&
      file.facadeModuleId !== null &&
      normalizePath(file.facadeModuleId) === normalized
    ) {
      return file;
    }
  }
  return null;
}

function outputHref(fileName: string): string {
  return `/${normalizePath(fileName)}`;
}

function outputDirectory(root: string, options: OutputOptions): string {
  if (typeof options.dir === "string") return options.dir;
  if (typeof options.file === "string") return dirname(options.file);
  return resolve(root, "dist");
}

function rootAbsolutePath(root: string, specifier: string): string {
  return specifier.startsWith("/")
    ? resolve(root, specifier.slice(1))
    : resolve(root, specifier);
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function renderClientEntry(
  clientNodeEnv: FigStartPluginOptions["clientNodeEnv"],
): string {
  const devEnvImport =
    clientNodeEnv === undefined ? "" : `import "${DEV_ENV_ID}";\n`;

  return `${devEnvImport}import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

hydrateStart({
  context: { appName: start.appName },
  loadClientReference,
  onRecoverableError: start.onRecoverableError,
  routes: start.routes,
});
`;
}

function renderDevEnv(
  clientNodeEnv: FigStartPluginOptions["clientNodeEnv"],
): string {
  if (clientNodeEnv === undefined) return "export {};\n";

  return `globalThis.process ??= { env: {} };
globalThis.process.env ??= {};
globalThis.process.env.NODE_ENV ??= ${JSON.stringify(clientNodeEnv)};
export {};
`;
}

function renderServerEntry(): string {
  // Strip client-only fields so the rest spread forwards just server options.
  return `import { startServer } from "@bgub/fig-start/server";
import { resolveClientReferenceAssets } from "virtual:fig-start/server-manifest";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

function clientReferenceAssets(metadata) {
  const generated = resolveClientReferenceAssets(metadata);
  const app = serverOptions.clientReferenceAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

startServer({
  ...serverOptions,
  appUrl: import.meta.url,
  clientReferenceAssets,
  context: () => ({ appName }),
});
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
