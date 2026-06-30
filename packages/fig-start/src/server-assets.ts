import { readdir, readFile } from "node:fs/promises";

export interface ClientAssetResolver {
  resolve(requestUrl: string): Promise<URL | null>;
}

export function createClientAssetResolver(input: {
  appUrl: string;
  clientEntry: string;
}): ClientAssetResolver {
  const clientEntryPath = requestPathname(input.clientEntry);
  const basePath = publicDirname(clientEntryPath);
  const baseUrl = new URL(`.${basePath}`, new URL("./", input.appUrl));
  const clientEntryAsset = clientEntryPath.slice(basePath.length);
  let assetsPromise: Promise<ReadonlySet<string>> | null = null;

  return {
    async resolve(requestUrl) {
      const assetPath = assetPathFromRequest(requestUrl, basePath);
      if (assetPath === null) return null;
      assetsPromise ??= discoverClientAssets(baseUrl, clientEntryAsset);
      return (await assetsPromise).has(assetPath)
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

async function discoverClientAssets(
  baseUrl: URL,
  entryAsset: string,
): Promise<ReadonlySet<string>> {
  const assets = new Set<string>(await discoverSiblingCssAssets(baseUrl));
  const pending = [entryAsset];

  for (;;) {
    const asset = pending.pop();
    if (asset === undefined) return assets;
    if (assets.has(asset)) continue;
    assets.add(asset);

    const source = await readAsset(new URL(asset, baseUrl));
    if (source === null) continue;

    for (const specifier of clientJsSpecifiers(source)) {
      const child = assetPathFromSpecifier(baseUrl, asset, specifier);
      if (child !== null && !assets.has(child)) pending.push(child);
    }
  }
}

async function discoverSiblingCssAssets(baseUrl: URL): Promise<string[]> {
  if (baseUrl.protocol !== "file:") return [];

  try {
    const entries = await readdir(baseUrl);
    return entries.filter((entry) => safeAssetPath(entry)?.endsWith(".css"));
  } catch {
    return [];
  }
}

async function readAsset(url: URL): Promise<string | null> {
  try {
    return await readFile(url, "utf8");
  } catch {
    return null;
  }
}

function clientJsSpecifiers(source: string): string[] {
  return [...source.matchAll(JS_SPECIFIER_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined);
}

const JS_SPECIFIER_PATTERN =
  // Tracks vp pack's current ESM output for client chunks: literal relative
  // `.js` specifiers in static imports and dynamic `import(...)` calls.
  /\bimport\s*\(\s*["']([^"']+\.js)["']\s*\)|\b(?:from|import)\s*["']([^"']+\.js)["']/g;

function isServableAssetPath(path: string): boolean {
  return path.endsWith(".js") || path.endsWith(".css");
}

function assetPathFromSpecifier(
  baseUrl: URL,
  importer: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

  const assetUrl = new URL(specifier, new URL(importer, baseUrl));
  if (!assetUrl.href.startsWith(baseUrl.href)) return null;

  return safeAssetPath(assetUrl.href.slice(baseUrl.href.length));
}
