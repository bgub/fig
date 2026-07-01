import { readFile } from "node:fs/promises";
import { CLIENT_ASSET_MANIFEST_FILE } from "./vite/ids.ts";

export interface ClientAssetResolver {
  resolve(requestUrl: string): Promise<URL | null>;
}

export function createClientAssetResolver(input: {
  appUrl: string;
  cache?: boolean;
  clientEntry: string;
}): ClientAssetResolver {
  const clientEntryPath = requestPathname(input.clientEntry);
  const basePath = publicDirname(clientEntryPath);
  const baseUrl = new URL(`.${basePath}`, new URL("./", input.appUrl));
  const manifestUrl = new URL(
    `./${CLIENT_ASSET_MANIFEST_FILE}`,
    new URL("./", input.appUrl),
  );
  const clientEntryAsset = clientEntryPath.slice(basePath.length);
  const cache = input.cache ?? process.env.NODE_ENV === "production";
  let assetsPromise: Promise<ReadonlySet<string>> | null = null;

  return {
    async resolve(requestUrl) {
      const assetPath = assetPathFromRequest(requestUrl, basePath);
      if (assetPath === null) return null;
      if (cache) {
        assetsPromise ??= discoverClientAssets({
          basePath,
          baseUrl,
          entryAsset: clientEntryAsset,
          manifestUrl,
          warnOnMissingManifest: true,
        });
        return (await assetsPromise).has(assetPath)
          ? new URL(assetPath, baseUrl)
          : null;
      }

      return (
        await discoverClientAssets({
          basePath,
          baseUrl,
          entryAsset: clientEntryAsset,
          manifestUrl,
          warnOnMissingManifest: false,
        })
      ).has(assetPath)
        ? new URL(assetPath, baseUrl)
        : null;
    },
  };
}

export function requestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function publicDirname(pathname: string): string {
  const index = pathname.lastIndexOf("/");
  return pathname.slice(0, index + 1) || "/";
}

function assetPathFromRequest(
  requestUrl: string,
  basePath: string,
): string | null {
  const pathname = requestPathname(requestUrl);
  return pathname.startsWith(basePath)
    ? safeAssetPath(pathname.slice(basePath.length))
    : null;
}

function safeAssetPath(relativePath: string): string | null {
  if (!isServableAssetPath(relativePath)) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  const isSafe = decoded
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
  return isSafe ? decoded : null;
}

async function discoverClientAssets(input: {
  basePath: string;
  baseUrl: URL;
  entryAsset: string;
  manifestUrl: URL;
  warnOnMissingManifest: boolean;
}): Promise<ReadonlySet<string>> {
  const manifest = await readClientAssetManifest(input.manifestUrl);
  if (manifest === null) {
    if (input.warnOnMissingManifest) warnMissingClientAssetManifest();
    return new Set([input.entryAsset]);
  }

  const assets = new Set<string>([input.entryAsset]);
  for (const href of clientAssetManifestHrefs(manifest)) {
    const asset = manifestAssetPath(href, input.basePath);
    if (asset !== null) assets.add(asset);
  }
  return assets;
}

async function readAsset(url: URL): Promise<string | null> {
  try {
    return await readFile(url, "utf8");
  } catch {
    return null;
  }
}

async function readClientAssetManifest(
  url: URL,
): Promise<ClientAssetManifest | null> {
  const source = await readAsset(url);
  if (source === null) return null;

  try {
    return decodeClientAssetManifest(JSON.parse(source));
  } catch {
    return null;
  }
}

interface ClientAssetManifestEntry {
  assets?: readonly string[];
  css?: readonly string[];
  module?: string;
}

interface ClientAssetManifest {
  clientReferences: Record<string, ClientAssetManifestEntry>;
  serverRoutes: Record<string, ClientAssetManifestEntry>;
}

function decodeClientAssetManifest(value: unknown): ClientAssetManifest | null {
  if (!isRecord(value)) return null;

  return {
    clientReferences: decodeManifestEntries(value.clientReferences),
    serverRoutes: decodeManifestEntries(value.serverRoutes),
  };
}

function decodeManifestEntries(
  value: unknown,
): Record<string, ClientAssetManifestEntry> {
  if (!isRecord(value)) return {};

  const result: Record<string, ClientAssetManifestEntry> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    result[id] = {
      assets: stringArray(entry.assets),
      css: stringArray(entry.css),
      module: typeof entry.module === "string" ? entry.module : undefined,
    };
  }
  return result;
}

function clientAssetManifestHrefs(manifest: ClientAssetManifest): string[] {
  const hrefs: string[] = [];
  for (const entry of [
    ...Object.values(manifest.clientReferences),
    ...Object.values(manifest.serverRoutes),
  ]) {
    if (entry.module !== undefined) hrefs.push(entry.module);
    hrefs.push(...(entry.css ?? []), ...(entry.assets ?? []));
  }
  return hrefs;
}

function manifestAssetPath(href: string, basePath: string): string | null {
  const pathname = requestPathname(href);
  return pathname.startsWith(basePath)
    ? safeAssetPath(pathname.slice(basePath.length))
    : null;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let warnedMissingManifest = false;

function warnMissingClientAssetManifest(): void {
  if (warnedMissingManifest) return;
  warnedMissingManifest = true;
  console.warn(
    `[fig-start] ${CLIENT_ASSET_MANIFEST_FILE} is unavailable; serving only the configured client entry.`,
  );
}

export function isServableAssetPath(path: string): boolean {
  return /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|png|svg|txt|wasm|webp|woff2?|xml)$/i.test(
    path,
  );
}
