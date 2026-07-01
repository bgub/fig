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
  DEV_ENV_ID,
  MANIFEST_ID,
  ROOT_RELATIVE_VIRTUAL_IDS,
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
  renderDevEnv,
  renderManifest,
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
import {
  transformServerModule,
  transformServerRouteClientStub,
} from "./transform.ts";

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

function transformTarget(
  target: NonNullable<FigStartPluginOptions["target"]>,
  options: { ssr?: boolean } | undefined,
): "client" | "server" {
  if (target !== "auto") return target;
  return options?.ssr === true ? "server" : "client";
}
