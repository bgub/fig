import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { START_ENVIRONMENT_NAMES } from "@tanstack/start-plugin-core/vite";
import type { EnvironmentModuleNode, Plugin } from "vite";
import { rewriteFrameworkImports } from "./compatibility-profile.ts";
import { compilerSourceIdFilter } from "./compiler-options.ts";
import {
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
import {
  enrichManifestReferences,
  resolvePayloadReferences,
  stylesheetSourceFingerprint,
} from "./payload-references.ts";
import { writePublicAsset } from "./public-assets.ts";
import { transformServerPayloadDefinitions } from "./server-payload-compiler.ts";

const payloadManifestDefinitionPrefix =
  "\0fig-tanstack-start:payload-manifest-definition:";
const payloadResolveIdPattern =
  /(?:^virtual:fig-tanstack-start\/payload-(?:runtime|manifest)$|[?&]fig-payload-(?:module|manifest)(?:=|&|$))/;
const payloadLoadIdPattern = new RegExp(
  `^(?:${resolvedPayloadRuntimeId}|${resolvedPayloadManifestId}|${payloadManifestDefinitionPrefix})`,
);

export function serverPayloadPlugin() {
  return {
    name: "fig-tanstack-start:server-payload",
    enforce: "pre",
    applyToEnvironment: isStartEnvironment,
    transform: {
      filter: { code: "serverPayload", id: compilerSourceIdFilter },
      handler: transformServerPayloadDefinitions,
    },
  } satisfies Plugin;
}

export function payloadPlugin() {
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
    applyToEnvironment: isStartEnvironment,
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
      const writes: Promise<void>[] = [];
      for (const output of Object.values(bundle)) {
        if (
          output.type !== "asset" ||
          !output.fileName.startsWith(serverAssetsPrefix) ||
          output.fileName.endsWith(".map")
        ) {
          continue;
        }
        writes.push(
          writePublicAsset(
            resolve(publicOutDir, output.fileName),
            output.source,
          ),
        );
      }
      await Promise.all(writes);
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== START_ENVIRONMENT_NAMES.client) return;
      collectClientStylesheets(bundle, clientStylesheets, base);
    },
    resolveId: {
      filter: { id: payloadResolveIdPattern },
      async handler(source, importer) {
        if (source === payloadRuntimeId) return resolvedPayloadRuntimeId;
        if (source === payloadManifestId) return resolvedPayloadManifestId;
        const payloadModule = hasModuleQuery(source, payloadModuleQuery);
        if (
          !payloadModule &&
          !hasModuleQuery(source, payloadManifestDefinitionQuery)
        ) {
          return undefined;
        }

        const resolved = await this.resolve(cleanModuleId(source), importer, {
          skipSelf: true,
        });
        if (resolved === null) return null;
        const resolvedId = cleanModuleId(resolved.id);
        if (payloadModule) {
          return withModuleQuery(resolvedId, payloadModuleQuery, "1");
        }
        // Start protects .server modules from the client graph. The manifest
        // needs only their compiled definitions, so expose those definitions
        // through a private virtual id before import protection runs.
        return definitionModuleId(resolvedId);
      },
    },
    load: {
      filter: { id: payloadLoadIdPattern },
      async handler(id) {
        if (id === resolvedPayloadRuntimeId) return payloadRuntimeCode();
        if (id === resolvedPayloadManifestId) {
          return payloadManifestRuntimeCode(clientStylesheets);
        }
        if (!id.startsWith(payloadManifestDefinitionPrefix)) return undefined;

        const sourceId = decodeOpaqueId(
          id.slice(payloadManifestDefinitionPrefix.length),
        );
        const code = rewriteFrameworkImports(await readFile(sourceId, "utf8"));
        const resolvedReferences = await resolvePayloadReferences(
          sourceId,
          code,
          (source, importer) =>
            this.resolve(source, importer, { skipSelf: true }),
          root,
        );
        const { references, stylesheetSources } =
          await enrichManifestReferences(
            resolvedReferences,
            root,
            (source, importer) =>
              this.resolve(source, importer, { skipSelf: true }),
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
    transform: {
      filter: { id: compilerSourceIdFilter },
      async handler(code, id) {
        if (
          this.environment.name !== START_ENVIRONMENT_NAMES.server ||
          !mayBePayloadModule(code, id)
        ) {
          return null;
        }
        const references = await resolvePayloadReferences(
          id,
          code,
          (source, importer) =>
            this.resolve(source, importer, { skipSelf: true }),
          root,
        );
        return transformPayloadModule(code, id, references);
      },
    },
  } satisfies Plugin;
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

function collectClientStylesheets(
  bundle: OutputBundle,
  clientStylesheets: Map<string, string[]>,
  base: string,
): void {
  clientStylesheets.clear();
  const assetBase = base.replace(/\/$/, "");
  for (const output of Object.values(bundle)) {
    if (output.type !== "chunk") continue;
    const referenceIds = payloadReferenceIds(Object.keys(output.modules));
    for (const referenceId of referenceIds) {
      const stylesheets = new Set(clientStylesheets.get(referenceId));
      for (const file of output.viteMetadata?.importedCss ?? []) {
        stylesheets.add(`${assetBase}/${file}`);
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

function isStartEnvironment(environment: { name: string }): boolean {
  return (
    environment.name === START_ENVIRONMENT_NAMES.client ||
    environment.name === START_ENVIRONMENT_NAMES.server
  );
}
