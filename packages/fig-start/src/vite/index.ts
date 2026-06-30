import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  type ClientRef,
  rootRelative,
  transformServerModule,
  transformServerRouteClientStub,
} from "./transform.ts";

const MANIFEST_ID = "virtual:fig-start/client-manifest";
const SERVER_MANIFEST_ID = "virtual:fig-start/server-manifest";
const CLIENT_ENTRY_ID = "virtual:fig-start/client-entry";
const SERVER_ENTRY_ID = "virtual:fig-start/server-entry";
const DEV_ENV_ID = "virtual:fig-start/dev-env";
const SERVER_ROUTE_ASSETS_ID = "virtual:fig-start/server-route-assets";
const SERVER_ROUTE_ASSET_MODULE_PREFIX =
  "virtual:fig-start/server-route-asset-module:";
const CSS_MODULE_PREFIX = "virtual:fig-start/css-module:";
const CLIENT_ASSET_MANIFEST_FILE = "fig-start-client-assets.json";
const ROOT_RELATIVE_VIRTUAL_IDS = [
  MANIFEST_ID,
  CLIENT_ENTRY_ID,
  SERVER_ENTRY_ID,
  SERVER_MANIFEST_ID,
  SERVER_ROUTE_ASSETS_ID,
] as const;

export interface FigStartPlugin {
  configResolved(config: { root?: string }): void;
  enforce: "pre";
  load(this: unknown, id: string): Promise<string | null>;
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
    importedAssets?: Iterable<string>;
    importedCss?: Iterable<string>;
  };
}

interface ClientAssetManifestEntry {
  assets?: string[];
  css?: string[];
  module?: string;
}

interface ClientAssetManifest {
  clientReferences: Record<string, ClientAssetManifestEntry>;
  serverRoutes: Record<string, ClientAssetManifestEntry>;
}

interface ServerRouteRef {
  id: string;
  specifier: string;
}

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
    [SERVER_ROUTE_ASSETS_ID]: () => renderServerRouteAssets(root),
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
      if (id.startsWith(SERVER_ROUTE_ASSET_MODULE_PREFIX)) {
        return resolvedVirtualId(id);
      }
      if (isCssModuleSpecifier(id)) {
        const fromGeneratedVirtualModule =
          importer !== undefined &&
          (rootRelativeImporters.has(importer) ||
            importer.startsWith(
              resolvedVirtualId(SERVER_ROUTE_ASSET_MODULE_PREFIX),
            ));
        const absolute =
          id.startsWith("/") && fromGeneratedVirtualModule
            ? resolve(root, id.slice(1))
            : id.startsWith("/")
              ? id
              : importer === undefined ||
                  (!id.startsWith("./") && !id.startsWith("../"))
                ? null
                : resolve(dirname(importer.split("?")[0] ?? importer), id);
        if (absolute !== null) {
          return resolvedVirtualId(
            `${CSS_MODULE_PREFIX}${encodeIdPath(absolute)}`,
          );
        }
      }
      if (
        importer !== undefined &&
        (rootRelativeImporters.has(importer) ||
          importer.startsWith(
            resolvedVirtualId(SERVER_ROUTE_ASSET_MODULE_PREFIX),
          )) &&
        id.startsWith("/") &&
        !id.includes("?")
      ) {
        return resolve(root, id.slice(1));
      }
      if (
        importer !== undefined &&
        isAssetSpecifier(id) &&
        (id.startsWith("./") || id.startsWith("../"))
      ) {
        return resolve(dirname(importer.split("?")[0] ?? importer), id);
      }
      return null;
    },
    async load(id) {
      const clean = id.split("?")[0] ?? id;
      if (clean.startsWith(resolvedVirtualId(CSS_MODULE_PREFIX))) {
        return renderCssModule(
          this,
          root,
          decodeIdPath(clean.slice(resolvedVirtualId(CSS_MODULE_PREFIX).length)),
        );
      }
      if (isAssetId(clean)) {
        return renderStaticAssetModule(this, root, clean);
      }

      const render = id.startsWith("\0")
        ? virtualModules[id.slice(1)]
        : undefined;
      if (render !== undefined) return render();
      if (id.startsWith(resolvedVirtualId(SERVER_ROUTE_ASSET_MODULE_PREFIX))) {
        return renderServerRouteAssetModule(
          root,
          id.slice(resolvedVirtualId(SERVER_ROUTE_ASSET_MODULE_PREFIX).length),
        );
      }
      return null;
    },
    async transform(code, id, options) {
      const clean = id.split("?")[0] ?? id;
      if (tailwind !== false && isCssId(clean) && isTailwindCssEntry(code)) {
        return transformTailwindCss(code, clean, root, tailwind);
      }

      if (clean.startsWith("\0")) return null;

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

async function renderCssModule(
  context: unknown,
  root: string,
  id: string,
): Promise<string> {
  const source = await readFile(id, "utf8");
  const classes = cssModuleClasses(source, root, id);
  const css = rewriteCssModuleClasses(source, classes);
  const href = cssModuleHref(root, id);
  const emitFile = (context as { emitFile?: (asset: unknown) => void })
    .emitFile;

  if (typeof emitFile === "function") {
    emitFile.call(context, {
      fileName: href.slice(1),
      source: css,
      type: "asset",
    });
  }

  return `const classes = ${JSON.stringify(classes)};\nexport default classes;\n`;
}

async function renderStaticAssetModule(
  context: unknown,
  root: string,
  id: string,
): Promise<string> {
  const href = staticAssetHref(root, id);
  const emitFile = (context as { emitFile?: (asset: unknown) => void })
    .emitFile;

  if (typeof emitFile === "function") {
    emitFile.call(context, {
      fileName: href.slice(1),
      source: await readFile(id),
      type: "asset",
    });
  }

  return `export default ${JSON.stringify(href)};\n`;
}

function cssModuleClasses(
  source: string,
  root: string,
  id: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/\.([A-Za-z_-][\w-]*)/g)) {
    const local = match[1];
    if (local === undefined || result[local] !== undefined) continue;
    result[local] = `${cssModuleScope(root, id)}_${local}`;
  }
  return result;
}

function rewriteCssModuleClasses(
  source: string,
  classes: Record<string, string>,
): string {
  return source.replace(/\.([A-Za-z_-][\w-]*)/g, (match, local: string) =>
    classes[local] === undefined ? match : `.${classes[local]}`,
  );
}

function cssModuleHref(root: string, id: string): string {
  const name = basename(id, ".module.css");
  return `/fig-start/${name}-${hash(`${rootRelative(root, id)}:css`)}.css`;
}

function staticAssetHref(root: string, id: string): string {
  const extension = extname(id);
  const name = basename(id, extension);
  return `/fig-start/${name}-${hash(`${rootRelative(root, id)}:asset`)}${extension}`;
}

function cssModuleScope(root: string, id: string): string {
  return `_${hash(rootRelative(root, id)).slice(0, 7)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 10);
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
  const routes = await collectServerRoutes(root);
  const entries = refs
    .map(
      (ref) =>
        `  ${JSON.stringify(ref.id)}: { assets: [], css: [], module: ${JSON.stringify(
          ref.specifier,
        )} }`,
    )
    .join(",\n");
  const routeEntries = routes
    .map((route) => `  ${JSON.stringify(route.id)}: { assets: [], css: [] }`)
    .join(",\n");

  return `import { readFileSync } from "node:fs";
import { modulepreload, preload, stylesheet } from "@bgub/fig";

const refs = {\n${entries}\n};
const routes = {\n${routeEntries}\n};
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
  const built = readClientAssetManifest().clientReferences?.[metadata.id] ?? {};
  const assets = built.assets ?? ref.assets;
  const css = built.css ?? ref.css;
  const module = built.module ?? ref.module;
  return [
    ...css.map((href) => stylesheet(href)),
    ...assets.map(assetResource),
    modulepreload(module),
  ];
}

export function resolveServerRouteAssets(metadata) {
  const route = routes[metadata.id];
  if (route === undefined) return [];
  const built = readClientAssetManifest().serverRoutes?.[metadata.id] ?? {};
  const assets = built.assets ?? route.assets;
  const css = built.css ?? route.css;
  return [
    ...css.map((href) => stylesheet(href)),
    ...assets.map(assetResource),
  ];
}

function assetResource(href) {
  const type = assetType(href);
  if (type?.startsWith("font/")) {
    return preload(href, "font", { crossOrigin: "anonymous", type });
  }
  if (type?.startsWith("image/")) return preload(href, "image", { type });
  return preload(href, "fetch", type === undefined ? {} : { type });
}

function assetType(href) {
  const path = href.split("?")[0] ?? href;
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".woff2")) return "font/woff2";
  return undefined;
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

async function collectServerRoutes(root: string): Promise<ServerRouteRef[]> {
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
  const routes = await collectServerRoutes(root);
  const clientReferences: Record<string, ClientAssetManifestEntry> = {};
  const serverRoutes: Record<string, ClientAssetManifestEntry> = {};

  for (const ref of refs) {
    const chunk = outputChunkForModule(
      bundle,
      rootAbsolutePath(root, ref.specifier),
    );
    const entry: ClientAssetManifestEntry = {};
    if (chunk !== null) entry.module = outputHref(chunk.fileName);
    const css = chunk === null ? [] : outputCssHrefsForChunk(root, chunk);
    const assets = chunk === null ? [] : outputAssetHrefsForChunk(root, chunk);
    if (css.length > 0) entry.css = css;
    if (assets.length > 0) entry.assets = assets;
    clientReferences[ref.id] = entry;
  }

  for (const route of routes) {
    const chunk = outputChunkForModule(
      bundle,
      resolvedVirtualId(`${SERVER_ROUTE_ASSET_MODULE_PREFIX}${route.specifier}`),
    );
    const sourceAssets = await sourceAssetHrefsForModule(root, route.specifier);
    const entry: ClientAssetManifestEntry = {};
    const css = unique([
      ...(chunk === null ? [] : outputCssHrefsForChunk(root, chunk)),
      ...sourceAssets.css,
    ]);
    const assets = unique([
      ...(chunk === null ? [] : outputAssetHrefsForChunk(root, chunk)),
      ...sourceAssets.assets,
    ]);
    if (css.length > 0) entry.css = css;
    if (assets.length > 0) entry.assets = assets;
    serverRoutes[route.id] = entry;
  }

  return { clientReferences, serverRoutes };
}

function outputCssHrefsForChunk(root: string, chunk: OutputChunk): string[] {
  return unique([
    ...[...(chunk.viteMetadata?.importedCss ?? [])]
      .filter((fileName) => fileName.endsWith(".css"))
      .map(outputHref),
    ...(chunk.moduleIds ?? [])
      .map((id) => cssModuleIdPath(id))
      .filter((id): id is string => id !== null)
      .map((id) => cssModuleHref(root, id)),
  ]);
}

function outputAssetHrefsForChunk(root: string, chunk: OutputChunk): string[] {
  return unique([
    ...[...(chunk.viteMetadata?.importedAssets ?? [])]
      .filter(isPreloadableAsset)
      .map(outputHref),
    ...(chunk.moduleIds ?? [])
      .filter(isAssetId)
      .map((id) => staticAssetHref(root, id)),
  ]);
}

async function sourceAssetHrefsForModule(
  root: string,
  specifier: string,
): Promise<{ assets: string[]; css: string[] }> {
  const code = await readFile(rootAbsolutePath(root, specifier), "utf8").catch(
    () => "",
  );
  const css: string[] = [];
  const assets: string[] = [];

  for (const source of assetImportSpecifiers(code)) {
    const id = rootAbsolutePathForImport(root, specifier, source);
    if (id === null) continue;
    if (id.endsWith(".module.css")) css.push(cssModuleHref(root, id));
    if (isAssetId(id)) assets.push(staticAssetHref(root, id));
  }

  return { assets: unique(assets), css: unique(css) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isPreloadableAsset(fileName: string): boolean {
  const path = fileName.split("?")[0] ?? fileName;
  return /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)$/i.test(path);
}

function assetImportSpecifiers(code: string): string[] {
  return [...code.matchAll(ASSET_IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined)
    .filter(
      (specifier) => isCssSpecifier(specifier) || isAssetSpecifier(specifier),
    );
}

function isCssSpecifier(specifier: string): boolean {
  return specifier.split("?")[0]?.endsWith(".css") === true;
}

function isCssModuleSpecifier(specifier: string): boolean {
  return specifier.split("?")[0]?.endsWith(".module.css") === true;
}

function isAssetSpecifier(specifier: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)(?:\?|$)/i.test(specifier);
}

function isAssetId(id: string): boolean {
  return isAssetSpecifier(id.split("?")[0] ?? id);
}

function cssModuleIdPath(id: string): string | null {
  return id.startsWith(resolvedVirtualId(CSS_MODULE_PREFIX))
    ? decodeIdPath(id.slice(resolvedVirtualId(CSS_MODULE_PREFIX).length))
    : null;
}

function encodeIdPath(path: string): string {
  return Buffer.from(path).toString("base64url");
}

function decodeIdPath(path: string): string {
  return Buffer.from(path, "base64url").toString();
}

const ASSET_IMPORT_PATTERN =
  /\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

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

  return `${devEnvImport}import "${SERVER_ROUTE_ASSETS_ID}";
import { hydrateStart } from "@bgub/fig-start/client";
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

async function renderServerRouteAssets(root: string): Promise<string> {
  const routes = await collectServerRoutes(root);
  const entries = routes
    .map(
      (route) =>
        `  ${JSON.stringify(route.id)}: () => import(${JSON.stringify(
          `${SERVER_ROUTE_ASSET_MODULE_PREFIX}${route.specifier}`,
        )})`,
    )
    .join(",\n");

  return `const serverRouteAssets = {\n${entries}\n};
globalThis.__figStartServerRouteAssets = serverRouteAssets;
export {};
`;
}

async function renderServerRouteAssetModule(
  root: string,
  specifier: string,
): Promise<string> {
  const code = await readFile(rootAbsolutePath(root, specifier), "utf8").catch(
    () => "",
  );
  const imports = assetImportSpecifiers(code).map((source) =>
    rootRelativeImport(root, specifier, source),
  );
  if (imports.length === 0) return "export {};\n";

  const statements = imports.map((source, index) =>
    isCssSpecifier(source)
      ? `import ${JSON.stringify(source)};`
      : `import asset${index} from ${JSON.stringify(source)};\nvoid asset${index};`,
  );
  return `${statements.join("\n")}\nexport {};\n`;
}

function rootRelativeImport(
  root: string,
  importerSpecifier: string,
  source: string,
): string {
  if (!source.startsWith("./") && !source.startsWith("../")) return source;
  return rootRelative(
    root,
    resolve(dirname(rootAbsolutePath(root, importerSpecifier)), source),
  );
}

function rootAbsolutePathForImport(
  root: string,
  importerSpecifier: string,
  source: string,
): string | null {
  const clean = source.split("?")[0] ?? source;
  if (clean.startsWith("/")) return resolve(root, clean.slice(1));
  if (clean.startsWith("./") || clean.startsWith("../")) {
    return resolve(dirname(rootAbsolutePath(root, importerSpecifier)), clean);
  }
  return null;
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
import { resolveClientReferenceAssets, resolveServerRouteAssets } from "virtual:fig-start/server-manifest";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

function clientReferenceAssets(metadata) {
  const generated = resolveClientReferenceAssets(metadata);
  const app = serverOptions.clientReferenceAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

function serverRouteAssets(metadata) {
  const generated = resolveServerRouteAssets(metadata);
  const app = serverOptions.serverRouteAssets?.(metadata);
  if (app === undefined) return generated;
  return Array.isArray(app) ? [...generated, ...app] : [...generated, app];
}

startServer({
  ...serverOptions,
  appUrl: import.meta.url,
  clientReferenceAssets,
  context: () => ({ appName }),
  serverRouteAssets,
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
