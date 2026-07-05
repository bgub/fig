import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { hash, rootRelative } from "./path-utils.ts";

export async function renderStaticAssetModule(
  context: unknown,
  root: string,
  id: string,
): Promise<string> {
  const href = staticAssetHref(root, id);
  const emitFile = (context as { emitFile?: (asset: unknown) => void })
    .emitFile;

  if (typeof emitFile === "function") {
    emitFile.call(context, {
      fileName: href.slice(1),
      source: await readFile(id),
      type: "asset",
    });
  }

  return `export default ${JSON.stringify(href)};\n`;
}

export function staticAssetHref(root: string, id: string): string {
  const extension = extname(id);
  const name = basename(id, extension);
  return `/fig-start/${name}-${hash(`${rootRelative(root, id)}:asset`)}${extension}`;
}

export function isAssetSpecifier(specifier: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)(?:\?|$)/i.test(specifier);
}

export function isAssetId(id: string): boolean {
  return isAssetSpecifier(id.split("?")[0] ?? id);
}

export function isPreloadableAsset(fileName: string): boolean {
  const path = fileName.split("?")[0] ?? fileName;
  return /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)$/i.test(path);
}
