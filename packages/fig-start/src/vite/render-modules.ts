import { readFile } from "node:fs/promises";
import {
  CLIENT_HYDRATE_GLOBAL,
  CLIENT_REFERENCE_PRELOAD_GLOBAL,
} from "../bootstrap.ts";
import { assetImportSpecifiers, isCssSpecifier } from "./asset-imports.ts";
import {
  CLIENT_ASSET_MANIFEST_FILE,
  DEV_ENV_ID,
  SERVER_ROUTE_ASSETS_ID,
  SERVER_ROUTE_ASSET_MODULE_PREFIX,
} from "./ids.ts";
import { rootAbsolutePath, rootRelativeImport } from "./path-utils.ts";
import { collectClientRefs, collectServerRoutes } from "./refs.ts";

export async function renderManifest(root: string): Promise<string> {
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

export async function renderServerManifest(root: string): Promise<string> {
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
let warnedClientAssetManifest = false;

function readClientAssetManifest() {
  const shouldCache = process.env.NODE_ENV === "production";
  if (shouldCache && clientAssetManifest !== undefined) return clientAssetManifest;
  try {
    const manifest = JSON.parse(readFileSync(new URL(${JSON.stringify(
      `./${CLIENT_ASSET_MANIFEST_FILE}`,
    )}, import.meta.url), "utf8"));
    if (shouldCache) clientAssetManifest = manifest;
    return manifest;
  } catch (error) {
    if (!warnedClientAssetManifest) {
      warnedClientAssetManifest = true;
      console.warn(
        "[fig-start] Client asset manifest is unavailable; falling back to source-specifier client-reference assets.",
        error,
      );
    }
    if (shouldCache) clientAssetManifest = {};
    return {};
  }
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

export function renderClientEntry(clientNodeEnv?: string): string {
  const devEnvImport =
    clientNodeEnv === undefined ? "" : `import "${DEV_ENV_ID}";\n`;

  return `${devEnvImport}import "${SERVER_ROUTE_ASSETS_ID}";
import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

function __figStartHydrate() {
  hydrateStart({
    context: { appName: start.appName },
    loadClientReference,
    onRecoverableError: start.onRecoverableError,
    routes: start.routes,
  });
}

if (globalThis[${JSON.stringify(CLIENT_REFERENCE_PRELOAD_GLOBAL)}] === true) {
  globalThis[${JSON.stringify(CLIENT_HYDRATE_GLOBAL)}] = __figStartHydrate;
} else {
  __figStartHydrate();
}
`;
}

export async function renderServerRouteAssets(root: string): Promise<string> {
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

export async function renderServerRouteAssetModule(
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

export function renderDevEnv(clientNodeEnv?: string): string {
  if (clientNodeEnv === undefined) return "export {};\n";

  return `globalThis.process ??= { env: {} };
globalThis.process.env ??= {};
globalThis.process.env.NODE_ENV ??= ${JSON.stringify(clientNodeEnv)};
export {};
`;
}

export function renderServerEntry(): string {
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
