import { readFile } from "node:fs/promises";
import { cssModuleHref, cssModuleIdPath } from "./css-modules.ts";
import {
  normalizePath,
  outputHref,
  rootAbsolutePath,
  rootAbsolutePathForImport,
} from "./path-utils.ts";
import { collectClientRefs, collectServerRoutes } from "./refs.ts";
import {
  isAssetId,
  isPreloadableAsset,
  staticAssetHref,
} from "./static-assets.ts";
import {
  CLIENT_ENTRY_ID,
  SERVER_ROUTE_ASSET_MODULE_PREFIX,
  resolvedVirtualId,
} from "./ids.ts";
import { assetImportSpecifiers } from "./asset-imports.ts";

export type OutputBundle = Record<string, OutputAsset | OutputChunk>;

interface OutputAsset {
  fileName: string;
  source?: unknown;
  type: "asset";
}

export interface OutputChunk {
  facadeModuleId?: string | null;
  fileName: string;
  imports?: string[];
  moduleIds?: string[];
  type: "chunk";
  viteMetadata?: {
    importedAssets?: Iterable<string>;
    importedCss?: Iterable<string>;
  };
}

interface ClientAssetManifestEntry {
  assets?: string[];
  css?: string[];
  module?: string;
}

interface ClientAssetManifest {
  assets: string[];
  client: ClientAssetManifestEntry;
  clientReferences: Record<string, ClientAssetManifestEntry>;
  serverRoutes: Record<string, ClientAssetManifestEntry>;
}

export async function renderClientAssetManifest(
  root: string,
  bundle: OutputBundle,
): Promise<ClientAssetManifest> {
  const refs = await collectClientRefs(root);
  const routes = await collectServerRoutes(root);
  const assets = outputAssetAllowlistHrefsForBundle(bundle);
  const client = clientAssetEntryForChunkTree(
    root,
    bundle,
    outputChunkForModule(bundle, resolvedVirtualId(CLIENT_ENTRY_ID)),
  );
  const clientReferences: Record<string, ClientAssetManifestEntry> = {};
  const serverRoutes: Record<string, ClientAssetManifestEntry> = {};

  for (const ref of refs) {
    const chunk = outputChunkForModule(
      bundle,
      rootAbsolutePath(root, ref.specifier),
    );
    const entry = clientAssetEntryForChunk(root, chunk);
    clientReferences[ref.id] = entry;
  }

  for (const route of routes) {
    const chunk = outputChunkForModule(
      bundle,
      resolvedVirtualId(
        `${SERVER_ROUTE_ASSET_MODULE_PREFIX}${route.specifier}`,
      ),
    );
    const sourceAssets = await sourceAssetHrefsForModule(root, route.specifier);
    const entry: ClientAssetManifestEntry = {};
    const css = unique([
      ...(chunk === null ? [] : outputCssHrefsForChunk(root, chunk)),
      ...sourceAssets.css,
    ]);
    const assets = unique([
      ...(chunk === null ? [] : outputAssetHrefsForChunk(root, chunk)),
      ...sourceAssets.assets,
    ]);
    if (css.length > 0) entry.css = css;
    if (assets.length > 0) entry.assets = assets;
    serverRoutes[route.id] = entry;
  }

  return { assets, client, clientReferences, serverRoutes };
}

function clientAssetEntryForChunkTree(
  root: string,
  bundle: OutputBundle,
  chunk: OutputChunk | null,
): ClientAssetManifestEntry {
  const entry: ClientAssetManifestEntry = {};
  if (chunk === null) return entry;

  entry.module = outputHref(chunk.fileName);
  const chunks = outputChunksForChunkTree(bundle, chunk);
  const css = unique(
    chunks.flatMap((item) => outputCssHrefsForChunk(root, item)),
  );
  const assets = unique(
    chunks.flatMap((item) => outputAssetHrefsForChunk(root, item)),
  );
  if (css.length > 0) entry.css = css;
  if (assets.length > 0) entry.assets = assets;
  return entry;
}

function clientAssetEntryForChunk(
  root: string,
  chunk: OutputChunk | null,
): ClientAssetManifestEntry {
  const entry: ClientAssetManifestEntry = {};
  if (chunk === null) return entry;

  entry.module = outputHref(chunk.fileName);
  const css = outputCssHrefsForChunk(root, chunk);
  const assets = outputAssetHrefsForChunk(root, chunk);
  if (css.length > 0) entry.css = css;
  if (assets.length > 0) entry.assets = assets;
  return entry;
}

function outputChunksForChunkTree(
  bundle: OutputBundle,
  chunk: OutputChunk,
): OutputChunk[] {
  const chunksByFileName = new Map<string, OutputChunk>();
  for (const file of Object.values(bundle)) {
    if (file.type === "chunk") chunksByFileName.set(file.fileName, file);
  }

  const seen = new Set<string>();
  const chunks: OutputChunk[] = [];
  const visit = (item: OutputChunk): void => {
    if (seen.has(item.fileName)) return;
    seen.add(item.fileName);
    chunks.push(item);

    for (const importedFileName of item.imports ?? []) {
      const imported = chunksByFileName.get(importedFileName);
      if (imported !== undefined) visit(imported);
    }
  };

  visit(chunk);
  return chunks;
}

function outputCssHrefsForChunk(root: string, chunk: OutputChunk): string[] {
  return unique([
    ...[...(chunk.viteMetadata?.importedCss ?? [])]
      .filter((fileName) => fileName.endsWith(".css"))
      .map(outputHref),
    ...(chunk.moduleIds ?? [])
      .map((id) => cssModuleIdPath(id))
      .filter((id): id is string => id !== null)
      .map((id) => cssModuleHref(root, id)),
  ]);
}

function outputAssetHrefsForChunk(root: string, chunk: OutputChunk): string[] {
  return unique([
    ...[...(chunk.viteMetadata?.importedAssets ?? [])]
      .filter(isPreloadableAsset)
      .map(outputHref),
    ...(chunk.moduleIds ?? [])
      .filter(isAssetId)
      .map((id) => staticAssetHref(root, id)),
  ]);
}

function outputAssetAllowlistHrefsForBundle(bundle: OutputBundle): string[] {
  const hrefs: string[] = [];
  for (const file of Object.values(bundle)) {
    if (file.type === "chunk") {
      hrefs.push(outputHref(file.fileName));
      continue;
    }

    if (file.fileName.endsWith(".css") || isPreloadableAsset(file.fileName)) {
      hrefs.push(outputHref(file.fileName));
    }
  }
  return unique(hrefs);
}

async function sourceAssetHrefsForModule(
  root: string,
  specifier: string,
): Promise<{ assets: string[]; css: string[] }> {
  const code = await readFile(rootAbsolutePath(root, specifier), "utf8").catch(
    () => "",
  );
  const css: string[] = [];
  const assets: string[] = [];

  for (const source of assetImportSpecifiers(code)) {
    const id = rootAbsolutePathForImport(root, specifier, source);
    if (id === null) continue;
    if (id.endsWith(".module.css")) css.push(cssModuleHref(root, id));
    if (isAssetId(id)) assets.push(staticAssetHref(root, id));
  }

  return { assets: unique(assets), css: unique(css) };
}

function outputChunkForModule(
  bundle: OutputBundle,
  modulePath: string,
): OutputChunk | null {
  const normalized = normalizePath(modulePath);
  for (const file of Object.values(bundle)) {
    if (file.type !== "chunk") continue;
    const ids = file.moduleIds ?? [];
    if (ids.some((id) => normalizePath(id) === normalized)) return file;
    if (
      file.facadeModuleId !== undefined &&
      file.facadeModuleId !== null &&
      normalizePath(file.facadeModuleId) === normalized
    ) {
      return file;
    }
  }
  return null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
