import { Buffer } from "node:buffer";
import { isAbsolute, relative, sep } from "node:path";

export const payloadManifestDefinitionQuery = "fig-payload-manifest";
export const payloadReferenceQuery = "fig-payload-reference";

export function cleanModuleId(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

export function isServerComponentModuleId(id: string): boolean {
  return /\.server\.tsx?$/.test(cleanModuleId(id));
}

export function moduleQueryValue(id: string, name: string): string | undefined {
  const query = id.indexOf("?");
  if (query === -1) return undefined;
  const hash = id.indexOf("#", query);
  const value = new URLSearchParams(
    id.slice(query + 1, hash === -1 ? undefined : hash),
  ).get(name);
  return value ?? undefined;
}

export function hasModuleQuery(id: string, name: string): boolean {
  return moduleQueryValue(id, name) !== undefined;
}

export function withModuleQuery(
  source: string,
  name: string,
  value: string,
): string {
  const hash = source.indexOf("#");
  const suffix = hash === -1 ? "" : source.slice(hash);
  const path = hash === -1 ? source : source.slice(0, hash);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${name}=${encodeURIComponent(value)}${suffix}`;
}

export function encodeOpaqueId(id: string): string {
  return Buffer.from(id).toString("base64url");
}

export function decodeOpaqueId(id: string): string {
  return Buffer.from(id, "base64url").toString();
}

export function toViteModulePath(root: string, moduleId: string): string {
  const clean = cleanModuleId(moduleId);
  const path = isAbsolute(clean) ? relative(root, clean) : clean;
  const normalized = normalizePath(path);
  return isAbsolute(path) || normalized.startsWith("../")
    ? toViteFsPath(clean)
    : `/${normalized.replace(/^\/+/, "")}`;
}

export function toViteFsPath(path: string): string {
  return `/@fs/${normalizePath(path).replace(/^\/+/, "")}`;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/").replaceAll("\\", "/");
}
