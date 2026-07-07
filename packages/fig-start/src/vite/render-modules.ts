import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assetImportSpecifiers, isCssSpecifier } from "./asset-imports.ts";
import {
  CLIENT_ASSET_MANIFEST_FILE,
  CLIENT_RUNTIME_ID,
  DEV_ENV_ID,
  SERVER_DATA_RESOURCES_ID,
  SERVER_ROUTE_ASSET_MODULE_PREFIX,
  SERVER_ROUTE_ASSETS_ID,
} from "./ids.ts";
import { rootAbsolutePath, rootRelativeImport } from "./path-utils.ts";
import { rootAbsolutePathForImport, rootRelative } from "./path-utils.ts";
import {
  collectClientRefs,
  collectServerDataResources,
  collectServerRoutes,
} from "./refs.ts";
import { staticAssetHref } from "./static-assets.ts";
import {
  discoverRouteDeclaration,
  discoverRouteRegistry,
} from "./transform.ts";

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
  const refEntries = await Promise.all(
    refs.map(async (ref) => {
      const assets = await sourceDevAssetHrefsForModule(root, ref.specifier);
      return { assets, ref };
    }),
  );
  const routeEntries = await Promise.all(
    routes.map(async (route) => {
      const assets = await sourceDevAssetHrefsForModule(root, route.specifier);
      return { assets, route };
    }),
  );
  const entries = refEntries
    .map(
      ({ assets, ref }) =>
        `  ${JSON.stringify(ref.id)}: { assets: ${JSON.stringify(
          assets.assets,
        )}, css: ${JSON.stringify(assets.css)}, module: ${JSON.stringify(
          ref.specifier,
        )} }`,
    )
    .join(",\n");
  const routeCode = routeEntries
    .map(
      ({ assets, route }) =>
        `  ${JSON.stringify(route.id)}: { assets: ${JSON.stringify(
          assets.assets,
        )}, css: ${JSON.stringify(assets.css)} }`,
    )
    .join(",\n");

  return `import { readFileSync } from "node:fs";
import { modulepreload, preload, stylesheet } from "@bgub/fig";

const refs = {\n${entries}\n};
const routes = {\n${routeCode}\n};
let clientAssetManifest;
let warnedClientAssetManifest = false;

function readClientAssetManifest() {
  if (import.meta.url.includes("virtual:fig-start/")) return {};
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

  return `${devEnvImport}import { startFigStartClient } from "${CLIENT_RUNTIME_ID}";

startFigStartClient();
`;
}

export function renderClientRuntime(): string {
  return `import "${SERVER_ROUTE_ASSETS_ID}";
import { hydrateStart } from "@bgub/fig-start/client";
import { loadClientReference } from "virtual:fig-start/client-manifest";
import { start } from "/src/start.tsx";

export function startFigStartClient() {
  hydrateStart({
    context: { appName: start.appName },
    loadClientReference,
    onRecoverableError: start.onRecoverableError,
    routes: start.routes,
  });
}
`;
}

export async function renderClientRoutes(root: string): Promise<string> {
  const registryFile = await readRouteRegistryFile(root);
  const registryCode = await readFile(registryFile, "utf8");
  const registry = await discoverRouteRegistry(registryCode, registryFile);
  const refsByLocalName = new Map(
    registry.refs.map((ref) => [ref.localName, ref]),
  );
  const routeEntries = [];

  for (const localName of registry.order) {
    const ref = refsByLocalName.get(localName);
    if (ref === undefined) continue;
    const specifier = rootRelativeImport(
      root,
      rootRelative(root, registryFile),
      ref.specifier,
    );
    const routeFile = rootAbsolutePath(root, specifier);
    const routeCode = await readFile(routeFile, "utf8");
    const declaration = await discoverRouteDeclaration(routeCode, routeFile);
    routeEntries.push({ declaration, specifier });
  }

  const imports = new Set<string>();
  const declarations: string[] = [];
  const routeNames: string[] = [];
  const routePreloads: string[] = [];
  let needsLazyRouteRuntime = false;
  let needsServerRouteRuntime = false;

  routeEntries.forEach((entry, index) => {
    const routeName = `__figRoute${index}`;
    routeNames.push(routeName);

    if (entry.declaration.kind === "root") {
      declarations.push(
        `import { Route as ${routeName} } from ${JSON.stringify(
          entry.specifier,
        )};`,
      );
      return;
    }

    if (entry.declaration.kind !== "file" || entry.declaration.path === null) {
      declarations.push(
        `import { Route as ${routeName} } from ${JSON.stringify(
          entry.specifier,
        )};`,
      );
      return;
    }

    if (isServerModuleSpecifier(entry.specifier)) {
      needsServerRouteRuntime = true;
      declarations.push(
        `const ${routeName} = __figMarkServerRoute(createFileRoute(${JSON.stringify(
          entry.declaration.path,
        )})());`,
      );
      return;
    }

    needsLazyRouteRuntime = true;
    const moduleName = `__figModule${index}`;
    const loadName = `__figLoadRoute${index}`;
    const componentName = `FigStartLazyRoute${index}`;
    routePreloads.push(
      `  ${JSON.stringify(entry.declaration.path)}: ${loadName}`,
    );
    declarations.push(
      `let ${moduleName};
function ${loadName}() {
  return ${moduleName} ??= import(${JSON.stringify(entry.specifier)});
}
const ${routeName} = createFileRoute(${JSON.stringify(entry.declaration.path)})({
  beforeLoad: async (args) => (await ${loadName}()).Route.options.beforeLoad?.(args),
  loader: async (args) => (await ${loadName}()).Route.options.loader?.(args),
  component: function ${componentName}() {
    const Component = readPromise(${loadName}()).Route.options.component;
    return Component === undefined ? createElement(Outlet, {}) : createElement(Component, {});
  },
});`,
    );
  });

  if (needsLazyRouteRuntime) {
    imports.add(
      `import { buildRouteTree, createFileRoute, matchRoutes, Outlet } from "@bgub/fig-start";`,
    );
  } else if (needsServerRouteRuntime) {
    imports.add(`import { createFileRoute } from "@bgub/fig-start";`);
  }
  if (needsLazyRouteRuntime) {
    imports.add(`import { createElement, readPromise } from "@bgub/fig";`);
  }
  if (needsServerRouteRuntime) {
    imports.add(
      `import { markServerRoute as __figMarkServerRoute } from "@bgub/fig-start/internal";`,
    );
  }

  const routesDeclaration = `const routes = [${routeNames.join(", ")}];`;
  const preloadDeclaration =
    routePreloads.length === 0
      ? ""
      : `${routesDeclaration}
const __figRoutePreloads = {
${routePreloads.join(",\n")}
};
await __figPreloadInitialRoute(routes, __figRoutePreloads);
export { routes };

async function __figPreloadInitialRoute(routes, preloads) {
  if (typeof document === "undefined") return;
  const href = __figInitialHref();
  if (href === undefined) return;
  const pathname = new URL(href, globalThis.location?.href ?? "http://localhost/").pathname;
  const matches = matchRoutes(buildRouteTree(routes), pathname);
  await Promise.all((matches ?? []).flatMap((match) => {
    const preload = preloads[match.node.id];
    return preload === undefined ? [] : [preload()];
  }));
}

function __figInitialHref() {
  const text = document.getElementById("__fig_start_state__")?.textContent;
  if (text !== undefined && text !== null && text.length > 0) {
    try {
      const state = JSON.parse(text);
      if (typeof state.href === "string") return state.href;
    } catch {}
  }
  return globalThis.location?.href;
}`;

  return `${[...imports, ...declarations].join("\n")}
${preloadDeclaration || `export ${routesDeclaration}`}
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

export async function renderServerDataResources(root: string): Promise<string> {
  const resources = await collectServerDataResources(root);
  if (resources.length === 0) {
    return "export const serverDataResources = {};\n";
  }

  const imports = resources
    .map(
      (resource, index) =>
        `import { ${resource.exportName} as resource${index} } from ${JSON.stringify(
          resource.specifier,
        )};`,
    )
    .join("\n");
  const entries = resources
    .map(
      (resource, index) => `  ${JSON.stringify(resource.id)}: resource${index}`,
    )
    .join(",\n");

  return `${imports}\nexport const serverDataResources = {\n${entries}\n};\n`;
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

async function sourceDevAssetHrefsForModule(
  root: string,
  specifier: string,
): Promise<{ assets: string[]; css: string[] }> {
  const code = await readFile(rootAbsolutePath(root, specifier), "utf8").catch(
    () => "",
  );
  const assets: string[] = [];
  const css: string[] = [];

  for (const source of assetImportSpecifiers(code)) {
    const id = rootAbsolutePathForImport(root, specifier, source);
    if (id === null) continue;
    if (isCssSpecifier(source)) css.push(rootRelative(root, id));
    else assets.push(staticAssetHref(root, id));
  }

  return { assets: unique(assets), css: unique(css) };
}

async function readRouteRegistryFile(root: string): Promise<string> {
  const candidates = [
    resolve(root, "src", "routes.ts"),
    resolve(root, "src", "routes.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next supported extension.
    }
  }
  throw new Error(
    `Fig Start could not find a route registry at ${rootRelative(
      dirname(root),
      resolve(root, "src", "routes.ts"),
    )} or ${rootRelative(dirname(root), resolve(root, "src", "routes.tsx"))}.`,
  );
}

function isServerModuleSpecifier(specifier: string): boolean {
  return specifier.endsWith(".server.ts") || specifier.endsWith(".server.tsx");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
import { serverDataResources } from "${SERVER_DATA_RESOURCES_ID}";
import { start } from "/src/start.tsx";

const { appName, onRecoverableError, ...serverOptions } = start;

async function context(request) {
  const appContext = await serverOptions.context?.(request);
  return appContext === null || typeof appContext !== "object"
    ? { appName }
    : { appName, ...appContext };
}

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
  context,
  serverDataResources,
  serverRouteAssets,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}
