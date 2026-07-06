import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type OutputBundle,
  renderClientAssetManifest,
} from "./asset-manifest.ts";
import {
  CSS_MODULE_PREFIX,
  CLIENT_ASSET_MANIFEST_FILE,
  CLIENT_ENTRY_ID,
  CLIENT_RUNTIME_ID,
  DEV_ENV_ID,
  MANIFEST_ID,
  ROOT_RELATIVE_VIRTUAL_IDS,
  SERVER_DATA_RESOURCES_ID,
  SERVER_ENTRY_ID,
  SERVER_MANIFEST_ID,
  SERVER_ROUTE_ASSETS_ID,
  SERVER_ROUTE_ASSET_MODULE_PREFIX,
  resolvedVirtualId,
} from "./ids.ts";
import { outputDirectory, type OutputOptions } from "./path-utils.ts";
import {
  decodeIdPath,
  encodeIdPath,
  isCssModuleSpecifier,
  renderCssModule,
} from "./css-modules.ts";
import {
  renderClientEntry,
  renderClientRuntime,
  renderDevEnv,
  renderManifest,
  renderServerDataResources,
  renderServerEntry,
  renderServerManifest,
  renderServerRouteAssetModule,
  renderServerRouteAssets,
} from "./render-modules.ts";
import {
  isAssetId,
  isAssetSpecifier,
  renderStaticAssetModule,
} from "./static-assets.ts";
import { isTailwindCssEntry, transformTailwindCss } from "./tailwind.ts";
import { assertNoServerDataResourceImport } from "../../../fig-data/src/vite/index.ts";
import {
  assertNoRemoteDataResourceImport,
  REMOTE_DATA_RESOURCE_CALLEE,
  transformServerModule,
  transformServerRouteClientStub,
} from "./transform.ts";

export interface FigStartPlugin {
  config?(config: FigStartViteConfig): void;
  configResolved(config: { root?: string }): void;
  enforce: "pre";
  load(this: unknown, id: string): Promise<string | null>;
  name: string;
  resolveId(id: string, importer?: string): string | null;
  tsdownConfig?(config: FigStartTsdownConfig): void;
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

type BuildEntry = BuildEntryItem | readonly BuildEntryItem[];
type BuildEntryItem = string | NamedBuildEntry;
type NamedBuildEntry = Record<string, string | readonly string[]>;

interface FigStartTsdownConfig {
  entry?: BuildEntry;
}

interface FigStartViteConfig {
  build?: {
    rollupOptions?: {
      input?: BuildEntry;
    };
  };
}

const CLIENT_RUNTIME_ENTRY_NAME = "fig-start-client-runtime";
const CLIENT_RUNTIME_NAMED_ENTRY = {
  [CLIENT_RUNTIME_ENTRY_NAME]: CLIENT_RUNTIME_ID,
};

// Vite plugin: rewrites `.tsx` imports inside `.server.tsx` modules into Fig
// client references, and serves generated virtual modules for Start's runtime.
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
    [CLIENT_RUNTIME_ID]: () => renderClientRuntime(),
    [SERVER_DATA_RESOURCES_ID]: () => renderServerDataResources(root),
    [SERVER_ENTRY_ID]: () => renderServerEntry(),
    [DEV_ENV_ID]: () => renderDevEnv(clientNodeEnv),
    [SERVER_ROUTE_ASSETS_ID]: () => renderServerRouteAssets(root),
  };

  return {
    name: "fig-start",
    enforce: "pre",
    config(config) {
      if (target !== "client") return;
      const rollupOptions = config.build?.rollupOptions;
      if (rollupOptions === undefined) return;
      rollupOptions.input = entryWithClientRuntime(
        rollupOptions.input,
        CLIENT_RUNTIME_ID,
      );
    },
    tsdownConfig(config) {
      if (target !== "client") return;
      config.entry = entryWithClientRuntime(
        config.entry,
        CLIENT_RUNTIME_NAMED_ENTRY,
      );
    },
    configResolved(config) {
      if (typeof config.root === "string") root = config.root;
    },
    async writeBundle(options, bundle) {
      if (target !== "client") return;
      const manifestPath = resolve(
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
        const absolute = resolveCssModuleId(
          root,
          rootRelativeImporters,
          id,
          importer,
        );
        if (absolute !== null) {
          return resolvedVirtualId(
            `${CSS_MODULE_PREFIX}${encodeIdPath(absolute)}`,
          );
        }
      }
      if (isRootRelativeVirtualImport(rootRelativeImporters, id, importer)) {
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
          decodeIdPath(
            clean.slice(resolvedVirtualId(CSS_MODULE_PREFIX).length),
          ),
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

      if (clean.includes("/node_modules/")) {
        return null;
      }
      if (!isServerModuleId(clean)) {
        if (code.includes("@bgub/fig-data/server")) {
          await assertNoServerDataResourceImport(code, clean);
        }
        if (code.includes(REMOTE_DATA_RESOURCE_CALLEE)) {
          await assertNoRemoteDataResourceImport(code, clean);
        }
        return null;
      }
      if (transformTarget(target, options) === "client") {
        const result = await transformServerRouteClientStub(code, clean, root);
        return { code: result.code, map: result.map };
      }

      const result = await transformServerModule(code, clean, root);
      if (
        result.clientRefs.length === 0 &&
        result.serverDataResources.length === 0 &&
        !result.marksServerRoute
      ) {
        return null;
      }
      return { code: result.code, map: result.map };
    },
  };
}

function entryWithClientRuntime(
  entry: BuildEntry | undefined,
  runtimeEntry: BuildEntryItem,
): BuildEntry | undefined {
  if (
    entry === undefined ||
    !entryIncludes(entry, CLIENT_ENTRY_ID) ||
    entryIncludes(entry, CLIENT_RUNTIME_ID)
  ) {
    return entry;
  }

  if (typeof entry === "string") return [entry, runtimeEntry];
  if (isBuildEntryArray(entry)) return [...entry, runtimeEntry];
  return { ...entry, [CLIENT_RUNTIME_ENTRY_NAME]: CLIENT_RUNTIME_ID };
}

function entryIncludes(entry: BuildEntry, specifier: string): boolean {
  if (typeof entry === "string") return entry === specifier;
  if (isBuildEntryArray(entry)) {
    return entry.some((item) =>
      typeof item === "string"
        ? item === specifier
        : namedBuildEntryIncludes(item, specifier),
    );
  }
  return namedBuildEntryIncludes(entry, specifier);
}

function isBuildEntryArray(
  entry: BuildEntry,
): entry is readonly BuildEntryItem[] {
  return Array.isArray(entry);
}

function namedBuildEntryIncludes(
  input: NamedBuildEntry,
  specifier: string,
): boolean {
  return Object.values(input).some((value) =>
    typeof value === "string" ? value === specifier : value.includes(specifier),
  );
}

function resolveCssModuleId(
  root: string,
  rootRelativeImporters: Set<string>,
  id: string,
  importer: string | undefined,
): string | null {
  if (id.startsWith("/")) {
    return isGeneratedRootRelativeImporter(rootRelativeImporters, importer)
      ? resolve(root, id.slice(1))
      : id;
  }
  if (
    importer === undefined ||
    (!id.startsWith("./") && !id.startsWith("../"))
  ) {
    return null;
  }
  return resolve(dirname(importer.split("?")[0] ?? importer), id);
}

function isRootRelativeVirtualImport(
  rootRelativeImporters: Set<string>,
  id: string,
  importer: string | undefined,
): boolean {
  return (
    isGeneratedRootRelativeImporter(rootRelativeImporters, importer) &&
    id.startsWith("/") &&
    !id.includes("?")
  );
}

function isGeneratedRootRelativeImporter(
  rootRelativeImporters: Set<string>,
  importer: string | undefined,
): boolean {
  return (
    importer !== undefined &&
    (rootRelativeImporters.has(importer) ||
      importer.startsWith(resolvedVirtualId(SERVER_ROUTE_ASSET_MODULE_PREFIX)))
  );
}

function isCssId(id: string): boolean {
  return id.endsWith(".css");
}

function isServerModuleId(id: string): boolean {
  return id.endsWith(".server.ts") || id.endsWith(".server.tsx");
}

function transformTarget(
  target: NonNullable<FigStartPluginOptions["target"]>,
  options: { ssr?: boolean } | undefined,
): "client" | "server" {
  if (target !== "auto") return target;
  return options?.ssr === true ? "server" : "client";
}
