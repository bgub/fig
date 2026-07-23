import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { START_ENVIRONMENT_NAMES } from "@tanstack/start-plugin-core/vite";
import type { EnvironmentModuleNode, PluginOption } from "vite";
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
  payloadManifestDefinitionQuery,
  payloadModuleQuery,
  toViteModulePath,
  withModuleQuery,
} from "./module-ids.ts";
import type { IsomorphicImport } from "./isomorphic-compiler.ts";
import {
  analyzeIsomorphicBoundaries,
  analyzeStylesheetImports,
  mayBePayloadModule,
  payloadRuntimeCode,
  payloadRuntimeId,
  resolvedPayloadRuntimeId,
  transformPayloadModule,
} from "./payload-compiler.ts";
import { transformServerPayloadDefinitions } from "./server-payload-compiler.ts";
import { writePublicAsset } from "./public-assets.ts";

const payloadManifestDefinitionPrefix =
  "\0fig-tanstack-start:payload-manifest-definition:";

export function serverPayloadPlugin(): PluginOption {
  return {
    name: "fig-tanstack-start:server-payload",
    enforce: "pre",
    transform: transformServerPayloadDefinitions,
  };
}

export function payloadPlugin(): PluginOption {
  let root = process.cwd();
  let base = "/";
  let clientOutDir: string | undefined;
  let serverAssetsPrefix = "assets/";
  // Start runs the client build before the server build with this plugin
  // instance. Retain Vite's final client CSS names for the server manifest.
  const clientStylesheets = new Map<string, string[]>();
  // Loaded manifest definitions read their source — and each referenced
  // component's stylesheet imports — through the filesystem, so the module
  // graph cannot see when those analyzed inputs change; hotUpdate compares
  // these fingerprints to reload only affected definitions.
  const definitionInputs = new Map<string, DefinitionInputs>();

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
      if (hasModuleQuery(source, payloadModuleQuery)) {
        const resolved = await this.resolve(cleanModuleId(source), importer, {
          skipSelf: true,
        });
        return resolved === null
          ? null
          : withModuleQuery(
              cleanModuleId(resolved.id),
              payloadModuleQuery,
              "1",
            );
      }
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
      return definitionModuleId(cleanModuleId(resolved.id));
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
      const code = rewriteFrameworkImports(await readFile(sourceId, "utf8"));
      const stylesheetSources = new Map<string, string>();
      const references = await collectPayloadReferences(
        sourceId,
        code,
        (source, importer) =>
          this.resolve(source, importer, { skipSelf: true }),
        root,
        stylesheetSources,
      );
      if (references.length > 0) {
        this.addWatchFile(sourceId);
        definitionInputs.set(sourceId, {
          boundaries: boundaryFingerprint(references),
          stylesheetSources,
        });
      } else {
        // A missing entry means the empty fingerprint, so the map only holds
        // the few definitions that actually have boundaries.
        definitionInputs.delete(sourceId);
      }
      return payloadManifestDefinitionCode(references);
    },
    async hotUpdate({ file, modules, read }) {
      const { moduleGraph } = this.environment;
      const invalidated = new Set<EnvironmentModuleNode>();
      let content: string | undefined;
      const readContent = async () => (content ??= await read());

      const definition = moduleGraph.getModuleById(definitionModuleId(file));
      if (definition !== undefined) {
        let changed: boolean;
        try {
          const boundaries = boundaryFingerprint(
            await analyzeIsomorphicBoundaries(
              rewriteFrameworkImports(await readContent()),
              file,
            ),
          );
          changed =
            (definitionInputs.get(file)?.boundaries ??
              emptyBoundaryFingerprint) !== boundaries;
        } catch {
          // Mid-edit analysis failures surface through the module's own
          // transform; reload the definition so the manifest cannot go stale.
          changed = true;
        }
        if (changed) invalidated.add(definition);
      }

      // The changed file may be a component module whose stylesheet imports
      // are embedded in other definitions as development hrefs.
      const dependents = [...definitionInputs].filter(([, inputs]) =>
        inputs.stylesheetSources.has(file),
      );
      if (dependents.length > 0) {
        let sources: string | undefined;
        try {
          sources = stylesheetSourceFingerprint(
            await analyzeStylesheetImports(await readContent(), file),
          );
        } catch {
          sources = undefined;
        }
        for (const [sourceId, inputs] of dependents) {
          if (inputs.stylesheetSources.get(file) === sources) continue;
          const dependent = moduleGraph.getModuleById(
            definitionModuleId(sourceId),
          );
          if (dependent !== undefined) invalidated.add(dependent);
        }
      }

      if (invalidated.size === 0) return undefined;
      return [...modules, ...invalidated];
    },
    async transform(code, id) {
      if (
        this.environment.name !== START_ENVIRONMENT_NAMES.server ||
        !mayBePayloadModule(code, id)
      ) {
        return null;
      }
      const references = await collectPayloadReferences(
        id,
        code,
        (source, importer) =>
          this.resolve(source, importer, { skipSelf: true }),
        root,
      );
      return transformPayloadModule(code, id, references);
    },
  };
}

interface DefinitionInputs {
  boundaries: string;
  // Referenced component module id → fingerprint of its stylesheet imports.
  stylesheetSources: Map<string, string>;
}

function definitionModuleId(sourceId: string): string {
  return `${payloadManifestDefinitionPrefix}${encodeOpaqueId(sourceId)}`;
}

function boundaryFingerprint(imports: readonly IsomorphicImport[]): string {
  return JSON.stringify(
    imports.map(({ importedName, localName, source }) => [
      source,
      importedName,
      localName,
    ]),
  );
}

const emptyBoundaryFingerprint = boundaryFingerprint([]);

// hotUpdate has no resolver, so fingerprints use the raw import specifiers
// rather than resolved stylesheet ids.
function stylesheetSourceFingerprint(sources: readonly string[]): string {
  return JSON.stringify(sources);
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
  stylesheetSources?: Map<string, string>,
): Promise<ManifestReference[]> {
  const importerId = cleanModuleId(id);
  const imports = await analyzeIsomorphicBoundaries(code, id);
  return Promise.all(
    imports.map(async (imported): Promise<ManifestReference> => {
      const resolved = await resolveModule(imported.source, importerId);
      if (resolved === null) {
        throw new Error(
          `Cannot resolve Isomorphic component import ${JSON.stringify(imported.source)} from ${importerId}.`,
        );
      }
      const moduleId = cleanModuleId(resolved.id);
      const referenceId = isomorphicReferenceId(
        root,
        moduleId,
        imported.importedName,
      );
      let hrefs: string[] = [];
      if (stylesheetSources !== undefined) {
        const stylesheets = await moduleStylesheets(
          moduleId,
          root,
          resolveModule,
        );
        hrefs = stylesheets.hrefs;
        stylesheetSources.set(
          moduleId,
          stylesheetSourceFingerprint(stylesheets.sources),
        );
      }
      return {
        ...imported,
        referenceId,
        resolvedModuleId: moduleId,
        developmentStylesheetHrefs: hrefs,
      };
    }),
  );
}

async function moduleStylesheets(
  moduleId: string,
  root: string,
  resolveModule: ResolveModule,
): Promise<{ hrefs: string[]; sources: string[] }> {
  if (!isAbsolute(moduleId)) return { hrefs: [], sources: [] };
  let code: string;
  try {
    code = await readFile(moduleId, "utf8");
  } catch {
    return { hrefs: [], sources: [] };
  }
  const sources = await analyzeStylesheetImports(code, moduleId);
  const hrefs = (
    await Promise.all(
      sources.map(async (source) => {
        const resolved = await resolveModule(source, moduleId);
        return resolved === null
          ? undefined
          : toViteModulePath(root, cleanModuleId(resolved.id));
      }),
    )
  ).filter((href): href is string => href !== undefined);
  return { hrefs, sources };
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
