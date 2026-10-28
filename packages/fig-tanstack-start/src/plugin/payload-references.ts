import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CompiledIsomorphicImport } from "./isomorphic-compiler.ts";
import {
  isomorphicReferenceId,
  type ManifestReference,
} from "./isomorphic-manifest.ts";
import { cleanModuleId, toViteModulePath } from "./module-ids.ts";
import {
  analyzeIsomorphicBoundaries,
  analyzeStylesheetImports,
} from "./payload-compiler.ts";

interface ResolvedPayloadReference extends CompiledIsomorphicImport {
  resolvedModuleId: string;
}

type ResolveModule = (
  source: string,
  importer: string,
) => Promise<{ id: string } | null>;

export async function resolvePayloadReferences(
  id: string,
  code: string,
  resolveModule: ResolveModule,
  root: string,
): Promise<ResolvedPayloadReference[]> {
  const importerId = cleanModuleId(id);
  const imports = await analyzeIsomorphicBoundaries(code, id);
  return Promise.all(
    imports.map(async (imported) => {
      const resolved = await resolveModule(imported.source, importerId);
      if (resolved === null) {
        throw new Error(
          `Cannot resolve Isomorphic component import ${JSON.stringify(imported.source)} from ${importerId}.`,
        );
      }
      const moduleId = cleanModuleId(resolved.id);
      return {
        ...imported,
        referenceId: isomorphicReferenceId(
          root,
          moduleId,
          imported.importedName,
        ),
        resolvedModuleId: moduleId,
      };
    }),
  );
}

export async function enrichManifestReferences(
  references: readonly ResolvedPayloadReference[],
  root: string,
  resolveModule: ResolveModule,
) {
  const stylesheetSources = new Map<string, string>();
  const enriched = await Promise.all(
    references.map(async (reference): Promise<ManifestReference> => {
      const { hrefs, sources } = await moduleStylesheets(
        reference.resolvedModuleId,
        root,
        resolveModule,
      );
      stylesheetSources.set(
        reference.resolvedModuleId,
        stylesheetSourceFingerprint(sources),
      );
      return { ...reference, developmentStylesheetHrefs: hrefs };
    }),
  );
  return { references: enriched, stylesheetSources };
}

// HMR compares raw import specifiers because hotUpdate has no resolver.
export function stylesheetSourceFingerprint(
  sources: readonly string[],
): string {
  return JSON.stringify(sources);
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
