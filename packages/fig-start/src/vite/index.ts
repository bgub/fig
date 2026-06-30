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
const CLIENT_ASSET_MANIFEST_FILE = "fig-start-client-assets.json";
const RAW_SUFFIX = "?raw";
const VIRTUAL_MODULES: Record<
  string,
  (root: string) => string | Promise<string>
> = {
  [MANIFEST_ID]: (root) => renderManifest(root),
  [SERVER_MANIFEST_ID]: (root) => renderServerManifest(root),
  [CLIENT_ENTRY_ID]: () => renderClientEntry(),
  [SERVER_ENTRY_ID]: () => renderServerEntry(),
};
const ROOT_RELATIVE_IMPORTERS = new Set(
  Object.keys(VIRTUAL_MODULES).map(resolvedVirtualId),
);

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
  target?: "auto" | "client" | "server";
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
  const target = options.target ?? "auto";

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
      if (id in VIRTUAL_MODULES) return resolvedVirtualId(id);
      if (id.endsWith(RAW_SUFFIX)) return resolveRawId(root, id, importer);
      if (
        importer !== undefined &&
        ROOT_RELATIVE_IMPORTERS.has(importer) &&
        id.startsWith("/") &&
        !id.includes("?")
      ) {
        return resolve(root, id.slice(1));
      }
      return null;
    },
    async load(id) {
      const render = id.startsWith("\0") ? VIRTUAL_MODULES[id.slice(1)] : undefined;
      if (render !== undefined) return render(root);
      if (id.endsWith(RAW_SUFFIX)) return renderRawFile(id);
      return null;
    },
    async transform(code, id, options) {
      const clean = id.split("?")[0] ?? id;
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

function resolvedVirtualId(id: string): string {
  return `\0${id}`;
}

function resolveRawId(
  root: string,
  id: string,
  importer: string | undefined,
): string | null {
  const path = id.slice(0, -RAW_SUFFIX.length);
  if (path.startsWith("/")) return `${resolve(root, path.slice(1))}${RAW_SUFFIX}`;
  if (importer === undefined) return `${resolve(root, path)}${RAW_SUFFIX}`;

  const importerPath = importer.split("?")[0] ?? importer;
  const resolved = resolve(dirname(importerPath), path);
  return `${resolved}${RAW_SUFFIX}`;
}

async function renderRawFile(id: string): Promise<string> {
  const path = id.slice(0, -RAW_SUFFIX.length);
  const content = await readFile(path, "utf8");
  return `export default ${JSON.stringify(content)};\n`;
}

function transformTarget(
  target: NonNullable<FigStartPluginOptions["target"]>,
  options: { ssr?: boolean } | undefined,
): "client" | "server" {
  if (target !== "auto") return target;
  return options?.ssr === true ? "server" : "client";
}

async function renderManifest(root: string): Promise<string> {
  const refs = await collectClientRefs(root, false);
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
  const refs = await collectClientRefs(root, true);
  const entries = refs
    .map(
      (ref) =>
        `  ${JSON.stringify(ref.id)}: { css: ${JSON.stringify(
          ref.css ?? [],
        )}, module: ${JSON.stringify(ref.specifier)} }`,
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
  } catch {
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

async function collectClientRefs(
  root: string,
  includeCss: boolean,
): Promise<ClientRef[]> {
  const files = await findServerModules(join(root, "src"));
  const refs = new Map<string, ClientRef>();

  for (const file of files) {
    const code = await readFile(file, "utf8");
    const { clientRefs } = await transformServerModule(code, file, root);
    for (const ref of clientRefs) {
      refs.set(
        ref.id,
        includeCss ? { ...ref, css: [] } : ref,
      );
    }
  }
  return [...refs.values()];
}

async function clientReferenceImportsCss(
  root: string,
  specifier: string,
): Promise<boolean> {
  const code = await readFile(rootAbsolutePath(root, specifier), "utf8").catch(
    () => null,
  );
  if (code === null) return false;

  return cssImportSpecifiers(code).length > 0;
}

function cssImportSpecifiers(code: string): string[] {
  return [...code.matchAll(CSS_IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined);
}

const CSS_IMPORT_PATTERN =
  /\bimport\s*\(\s*["']([^"']+\.css)["']\s*\)|\b(?:from|import)\s*["']([^"']+\.css)["']/g;

async function renderClientAssetManifest(
  root: string,
  bundle: OutputBundle,
): Promise<ClientAssetManifest> {
  const refs = await collectClientRefs(root, true);
  const css = outputCssHrefs(bundle);
  const manifest: ClientAssetManifest = {};

  for (const ref of refs) {
    const chunk = outputChunkForModule(
      bundle,
      rootAbsolutePath(root, ref.specifier),
    );
    const entry: ClientAssetManifestEntry = {};
    if (chunk !== null) entry.module = outputHref(chunk.fileName);
    if (await clientReferenceImportsCss(root, ref.specifier)) entry.css = css;
    manifest[ref.id] = entry;
  }

  return manifest;
}

function outputCssHrefs(bundle: OutputBundle): string[] {
  return Object.values(bundle)
    .filter((file): file is OutputAsset => file.type === "asset")
    .map((file) => file.fileName)
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

function renderClientEntry(): string {
  return `import { hydrateStart } from "@bgub/fig-start/client";
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
