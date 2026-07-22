import { sourceModuleExtensions } from "./compiler-options.ts";
import type { CompiledIsomorphicImport } from "./isomorphic-compiler.ts";
import {
  decodeOpaqueId,
  encodeOpaqueId,
  moduleQueryValue,
  payloadManifestDefinitionQuery,
  payloadReferenceQuery,
  toViteModulePath,
  withModuleQuery,
} from "./module-ids.ts";

export const payloadManifestId = "virtual:fig-tanstack-start/payload-manifest";
export const resolvedPayloadManifestId = `\0${payloadManifestId}`;

export interface ManifestReference extends CompiledIsomorphicImport {
  developmentStylesheetHrefs: string[];
  resolvedModuleId: string;
}

export function isomorphicReferenceId(
  root: string,
  moduleId: string,
  exportName: string,
): string {
  return `${toViteModulePath(root, moduleId)}#${exportName}`;
}

export function payloadManifestDefinitionCode(
  references: readonly ManifestReference[],
): string {
  const entries = references.map((reference) => {
    const moduleId = withModuleQuery(
      reference.resolvedModuleId,
      payloadReferenceQuery,
      encodeOpaqueId(reference.referenceId),
    );
    return `${JSON.stringify(reference.referenceId)}: {
      load: () => import(${JSON.stringify(moduleId)}).then((module) => module[${JSON.stringify(reference.importedName)}]),
      stylesheets: ${JSON.stringify(reference.developmentStylesheetHrefs)},
    }`;
  });
  return `export const references = {${entries.join(",\n")}};`;
}

export function payloadManifestRuntimeCode(
  clientStylesheets: ReadonlyMap<string, readonly string[]>,
): string {
  const assets = JSON.stringify(Object.fromEntries(clientStylesheets));
  return `import { stylesheet } from "@bgub/fig";
import { createPayloadClientReferenceResolver } from "@bgub/fig/payload";

const definitions = import.meta.glob([
  "/**/*.{${sourceModuleExtensions.join(",")}}",
  "!/**/*.d.ts",
  "!/**/*.test.*",
  "!/**/*.spec.*",
  "!/**/__tests__/**",
  "!/**/dist/**",
  "!/**/node_modules/**",
], {
  eager: true,
  import: "references",
  query: "?${payloadManifestDefinitionQuery}",
});
const references = Object.assign({}, ...Object.values(definitions));
const clientStylesheets = ${assets};

export const resolveIsomorphicReference = createPayloadClientReferenceResolver(
  (reference) => references[reference.id]?.load(),
);

export function compiledIsomorphicReferenceAssets({ id }) {
  const hrefs = clientStylesheets[id] ?? references[id]?.stylesheets ?? [];
  return hrefs.map((href) => stylesheet(href, { precedence: "isomorphic" }));
}`;
}

export function payloadReferenceIds(moduleIds: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const moduleId of moduleIds) {
    const id = moduleQueryValue(moduleId, payloadReferenceQuery);
    if (id !== undefined) ids.add(decodeOpaqueId(id));
  }
  return [...ids];
}
