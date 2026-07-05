import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";

export interface OutputOptions {
  dir?: string;
  file?: string;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 10);
}

export function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

export function rootRelative(root: string, absolutePath: string): string {
  return `/${relative(root, absolutePath).split(sep).join("/")}`;
}

export function outputDirectory(root: string, options: OutputOptions): string {
  if (typeof options.dir === "string") return options.dir;
  if (typeof options.file === "string") return dirname(options.file);
  return resolve(root, "dist");
}

export function outputHref(fileName: string): string {
  return `/${normalizePath(fileName)}`;
}

export function rootAbsolutePath(root: string, specifier: string): string {
  return specifier.startsWith("/")
    ? resolve(root, specifier.slice(1))
    : resolve(root, specifier);
}

export function rootAbsolutePathForImport(
  root: string,
  importerSpecifier: string,
  source: string,
): string | null {
  const clean = source.split("?")[0] ?? source;
  if (clean.startsWith("/")) return resolve(root, clean.slice(1));
  if (clean.startsWith("./") || clean.startsWith("../")) {
    return resolve(dirname(rootAbsolutePath(root, importerSpecifier)), clean);
  }
  return null;
}

export function rootRelativeImport(
  root: string,
  importerSpecifier: string,
  source: string,
): string {
  if (!source.startsWith("./") && !source.startsWith("../")) return source;
  return rootRelative(
    root,
    resolve(dirname(rootAbsolutePath(root, importerSpecifier)), source),
  );
}
