import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { START_ENVIRONMENT_NAMES } from "@tanstack/start-plugin-core/vite";
import type { PluginOption } from "vite";
import { rewriteFrameworkImports } from "./compatibility-profile.ts";
import {
  isomorphicReferenceId,
  type ManifestReference,
  payloadManifestDefinitionCode,
  payloadManifestId,
  payloadManifestRuntimeCode,
  payloadReferenceIds,
  resolvedPayloadManifestId,
} from "./isomorphic-manifest.ts";
import {
  cleanModuleId,
  decodeOpaqueId,
  encodeOpaqueId,
  hasModuleQuery,
  isServerComponentModuleId,
  payloadManifestDefinitionQuery,
  toViteModulePath,
} from "./module-ids.ts";
import {
  analyzePayloadModule,
  analyzeStylesheetImports,
  payloadRuntimeCode,
  payloadRuntimeId,
  resolvedPayloadRuntimeId,
  transformPayloadModule,
} from "./payload-compiler.ts";
import { writePublicAsset } from "./public-assets.ts";

const payloadManifestDefinitionPrefix =
  "\0fig-tanstack-start:payload-manifest-definition:";

export function payloadPlugin(): PluginOption {
  let root = process.cwd();
  let base = "/";
  let clientOutDir: string | undefined;
  let serverAssetsPrefix = "assets/";
  // Start runs the client build before the server build with this plugin
  // instance. Retain Vite's final client CSS names for the server manifest.
  const clientStylesheets = new Map<string, string[]>();

  return {
    name: "fig-tanstack-start:payload",
    enforce: "pre",
    configEnvironment(environmentName) {
      if (environmentName === START_ENVIRONMENT_NAMES.server) {
        return { build: { emitAssets: true } };
      }
      return undefined;
    },
    configResolved(config) {
      root = config.root;
      base = config.base;
      const outDir =
        config.environments[START_ENVIRONMENT_NAMES.client]?.build.outDir;
      if (outDir !== undefined) clientOutDir = resolve(config.root, outDir);
      const assetsDir =
        config.environments[START_ENVIRONMENT_NAMES.server]?.build.assetsDir;
      if (assetsDir !== undefined) {
        const normalized = assetsDir.replace(/\/+$/, "");
        serverAssetsPrefix = normalized === "" ? "" : `${normalized}/`;
      }
    },
    async writeBundle(_options, bundle) {
      if (
        this.environment.name !== START_ENVIRONMENT_NAMES.server ||
        clientOutDir === undefined
      ) {
        return;
      }

      const publicOutDir = clientOutDir;
      await Promise.all(
        Object.values(bundle).map(async (output) => {
          if (
            output.type !== "asset" ||
            !output.fileName.startsWith(serverAssetsPrefix) ||
            output.fileName.endsWith(".map")
          ) {
            return;
          }
          const path = resolve(publicOutDir, output.fileName);
          await writePublicAsset(path, output.source);
        }),
      );
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== START_ENVIRONMENT_NAMES.client) return;
      collectClientStylesheets(bundle, clientStylesheets, base);
    },
    async resolveId(source, importer) {
      if (source === payloadRuntimeId) return resolvedPayloadRuntimeId;
      if (source === payloadManifestId) return resolvedPayloadManifestId;
      if (!hasModuleQuery(source, payloadManifestDefinitionQuery)) {
        return undefined;
      }

      const resolved = await this.resolve(cleanModuleId(source), importer, {
        skipSelf: true,
      });
      if (resolved === null) return null;
      // Start protects .server modules from the client graph. The manifest
      // needs only their compiled definitions, so expose those definitions
      // through a private virtual id before import protection runs.
      return `${payloadManifestDefinitionPrefix}${encodeOpaqueId(
        cleanModuleId(resolved.id),
      )}`;
    },
    async load(id) {
      if (id === resolvedPayloadRuntimeId) return payloadRuntimeCode();
      if (id === resolvedPayloadManifestId) {
        return payloadManifestRuntimeCode(clientStylesheets);
      }
      if (!id.startsWith(payloadManifestDefinitionPrefix)) return undefined;

      const sourceId = decodeOpaqueId(
        id.slice(payloadManifestDefinitionPrefix.length),
      );
      this.addWatchFile(sourceId);
      const code = rewriteFrameworkImports(await readFile(sourceId, "utf8"));
      const references = await collectPayloadReferences(
        sourceId,
        code,
        (source, importer) =>
          this.resolve(source, importer, { skipSelf: true }),
        root,
        true,
      );
      return payloadManifestDefinitionCode(references);
    },
    async transform(code, id) {
      if (this.environment.name !== START_ENVIRONMENT_NAMES.server) return null;
      const references = await collectPayloadReferences(
        id,
        code,
        (source, importer) =>
          this.resolve(source, importer, { skipSelf: true }),
        root,
        false,
      );
      return transformPayloadModule(code, id, references);
    },
  };
}

type ResolveModule = (
  source: string,
  importer: string,
) => Promise<{ id: string } | null>;

async function collectPayloadReferences(
  id: string,
  code: string,
  resolveModule: ResolveModule,
  root: string,
  includeStylesheets: boolean,
): Promise<ManifestReference[]> {
  const importerId = cleanModuleId(id);
  const imports = await analyzePayloadModule(code, id);
  const compiled: ManifestReference[] = [];
  for (const imported of imports) {
    const resolved = await resolveModule(imported.source, importerId);
    if (resolved === null) continue;
    const moduleId = cleanModuleId(resolved.id);
    if (isServerComponentModuleId(moduleId)) continue;
    const referenceId = isomorphicReferenceId(
      root,
      moduleId,
      imported.importedName,
    );
    compiled.push({
      ...imported,
      referenceId,
      resolvedModuleId: moduleId,
      developmentStylesheetHrefs: includeStylesheets
        ? await moduleStylesheets(moduleId, root, resolveModule)
        : [],
    });
  }
  return compiled;
}

async function moduleStylesheets(
  moduleId: string,
  root: string,
  resolveModule: ResolveModule,
): Promise<string[]> {
  if (!isAbsolute(moduleId)) return [];
  let code: string;
  try {
    code = await readFile(moduleId, "utf8");
  } catch {
    return [];
  }
  const sources = await analyzeStylesheetImports(code, moduleId);
  const hrefs: string[] = [];
  for (const source of sources) {
    const resolved = await resolveModule(source, moduleId);
    if (resolved === null) continue;
    const stylesheetId = cleanModuleId(resolved.id);
    hrefs.push(toViteModulePath(root, stylesheetId));
  }
  return hrefs;
}

function collectClientStylesheets(
  bundle: OutputBundle,
  clientStylesheets: Map<string, string[]>,
  base: string,
): void {
  clientStylesheets.clear();
  for (const output of Object.values(bundle)) {
    if (output.type !== "chunk") continue;
    const referenceIds = payloadReferenceIds(Object.keys(output.modules));
    for (const referenceId of referenceIds) {
      const stylesheets = new Set(clientStylesheets.get(referenceId));
      for (const file of output.viteMetadata?.importedCss ?? []) {
        stylesheets.add(`${base.replace(/\/$/, "")}/${file}`);
      }
      clientStylesheets.set(referenceId, [...stylesheets]);
    }
  }
}

type OutputBundle = Record<string, OutputChunk | OutputAsset>;

interface OutputAsset {
  type: "asset";
}

interface OutputChunk {
  modules: Record<string, unknown>;
  type: "chunk";
  viteMetadata?: { importedCss?: Set<string> };
}
