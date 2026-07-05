import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { CSS_MODULE_PREFIX, resolvedVirtualId } from "./ids.ts";
import { hash, rootRelative } from "./path-utils.ts";

export async function renderCssModule(
  context: unknown,
  root: string,
  id: string,
): Promise<string> {
  const source = await readFile(id, "utf8");
  const classes = cssModuleClasses(source, root, id);
  const css = rewriteCssModuleClasses(source, classes);
  const href = cssModuleHref(root, id);
  const emitFile = (context as { emitFile?: (asset: unknown) => void })
    .emitFile;

  if (typeof emitFile === "function") {
    emitFile.call(context, {
      fileName: href.slice(1),
      source: css,
      type: "asset",
    });
  }

  return `const classes = ${JSON.stringify(classes)};\nexport default classes;\n`;
}

export function cssModuleHref(root: string, id: string): string {
  const name = basename(id, ".module.css");
  return `/fig-start/${name}-${hash(`${rootRelative(root, id)}:css`)}.css`;
}

export function cssModuleIdPath(id: string): string | null {
  return id.startsWith(resolvedVirtualId(CSS_MODULE_PREFIX))
    ? decodeIdPath(id.slice(resolvedVirtualId(CSS_MODULE_PREFIX).length))
    : null;
}

export function encodeIdPath(path: string): string {
  return Buffer.from(path).toString("base64url");
}

export function decodeIdPath(path: string): string {
  return Buffer.from(path, "base64url").toString();
}

export function isCssModuleSpecifier(specifier: string): boolean {
  return specifier.split("?")[0]?.endsWith(".module.css") === true;
}

function cssModuleClasses(
  source: string,
  root: string,
  id: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/\.([A-Za-z_-][\w-]*)/g)) {
    const local = match[1];
    if (local === undefined || result[local] !== undefined) continue;
    result[local] = `${cssModuleScope(root, id)}_${local}`;
  }
  return result;
}

function rewriteCssModuleClasses(
  source: string,
  classes: Record<string, string>,
): string {
  return source.replace(/\.([A-Za-z_-][\w-]*)/g, (match, local: string) =>
    classes[local] === undefined ? match : `.${classes[local]}`,
  );
}

function cssModuleScope(root: string, id: string): string {
  return `_${hash(rootRelative(root, id)).slice(0, 7)}`;
}
