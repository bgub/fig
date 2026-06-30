import { isAssetSpecifier } from "./static-assets.ts";

const ASSET_IMPORT_PATTERN =
  /\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export function assetImportSpecifiers(code: string): string[] {
  return [...code.matchAll(ASSET_IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined)
    .filter(
      (specifier) => isCssSpecifier(specifier) || isAssetSpecifier(specifier),
    );
}

export function isCssSpecifier(specifier: string): boolean {
  return specifier.split("?")[0]?.endsWith(".css") === true;
}
