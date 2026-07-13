import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { FigAssetResource, FigAssetResourceList } from "@bgub/fig";
import { figRefresh, type FigVitePlugin } from "@bgub/fig-vite";
import type {
  HmrContext,
  HmrOptions,
  InlineConfig,
  PluginOption,
  ViteDevServer,
} from "vite";
import type { StartConfig } from "../index.ts";
import type { StartHandler, StartHandlerOptions } from "../server.ts";
import { createRequestHandler } from "../server.ts";
import {
  DATA_ENDPOINT_PATH,
  DEV_SERVER_UPDATE_EVENT,
  type DevServerUpdateMessage,
} from "../bootstrap.ts";
import { isServableAssetPath, requestPathname } from "../server-assets.ts";
import { contentTypeFor } from "../server-runtime/content-type.ts";
import { createStartNodeServer } from "../server-runtime/node-http.ts";
import { runStartNodeRuntime } from "../server-runtime/runtime.ts";
import {
  assetImportSpecifiers,
  isCssSpecifier,
} from "../vite/asset-imports.ts";
import { renderCssModuleStyles } from "../vite/css-modules.ts";
import {
  CLIENT_ENTRY_ID,
  SERVER_DATA_RESOURCES_ID,
  SERVER_MANIFEST_ID,
} from "../vite/ids.ts";
import { rootAbsolutePathForImport, rootRelative } from "../vite/path-utils.ts";
import {
  figStart,
  type FigStartPlugin,
  type FigStartPluginOptions,
} from "../vite/index.ts";
import { staticAssetHref } from "../vite/static-assets.ts";
import { isTailwindCssEntry, transformTailwindCss } from "../vite/tailwind.ts";

export interface StartViteDevServerOptions {
  clientEntry?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  port?: number;
  publicUrl?: string;
  root?: string;
  tailwind?: FigStartPluginOptions["tailwind"];
  vite?: InlineConfig;
}

const FIG_START_EXTERNAL_PACKAGES = [
  "@bgub/fig",
  "@bgub/fig/payload",
  "@bgub/fig-dom",
  "@bgub/fig-server",
  "@bgub/fig-server/payload",
  "@bgub/fig-start",
  "@bgub/fig-start/client",
  "@bgub/fig-start/internal",
  "@bgub/fig-start/server",
] as const;

// Prebundle the Fig packages in dev. They are workspace-linked (outside
// node_modules once resolved), so Vite would otherwise serve every dist
// chunk as its own request. Entries that share stateful chunks must be
// optimized together in one pass: fig-reconciler with fig-dom (refresh
// state) and both fig-devtools entries (component store). The `a > b`
// entries reach packages that are not direct dependencies of the app root.
// @bgub/fig-start itself must stay unbundled: its client entry imports
// virtual:fig-start/client-manifest and listens via import.meta.hot, and
// neither survives prebundling.
const FIG_START_PREBUNDLED_PACKAGES = [
  "@bgub/fig",
  "@bgub/fig/internal",
  "@bgub/fig/jsx-runtime",
  "@bgub/fig/payload",
  "@bgub/fig-dom",
  "@bgub/fig-dom/refresh",
  "@bgub/fig-dom > @bgub/fig-reconciler",
  "@bgub/fig-dom > @bgub/fig-reconciler/refresh",
  "@bgub/fig-server/payload",
  "@bgub/fig-start > @bgub/fig-devtools",
  "@bgub/fig-start > @bgub/fig-devtools/client",
] as const;

interface StartModule {
  start: StartConfig;
}

interface ServerManifestModule {
  resolveClientReferenceAssets: (metadata: {
    id: string;
  }) => FigAssetResourceList;
  resolveServerRouteAssets: (metadata: { id: string }) => FigAssetResourceList;
}

interface ServerDataResourcesModule {
  serverDataResources: Record<string, unknown>;
}

type ViteTransformResult =
  Awaited<ReturnType<ViteDevServer["transformRequest"]>> extends infer Result
    ? NonNullable<Result>
    : never;

export async function startViteDevServer(
  options: StartViteDevServerOptions = {},
): Promise<Server> {
  const root = resolve(options.root ?? process.cwd());
  const port = options.port ?? 3000;
  const server = createStartNodeServer();
  const vite = await createFigStartViteServer(root, options, server);

  try {
    const started = await runStartNodeRuntime({
      config: {
        appUrl: pathToFileURL(resolve(root, "src/start.tsx")).href,
        cacheClientAssets: false,
        clientEntry: options.clientEntry,
        env: options.env,
        mode: "development",
        port,
        publicUrl: options.publicUrl,
        root,
      },
      createHandler: async (config) =>
        createViteStartHandler({
          clientEntry: config.clientEntry,
          root,
          tailwind: options.tailwind ?? false,
          vite,
        }),
      log: options.log ?? console.log,
      server,
    });
    started.once("close", () => {
      void vite.close();
    });
    return started;
  } catch (error) {
    await vite.close();
    throw error;
  }
}

async function createFigStartViteServer(
  root: string,
  options: StartViteDevServerOptions,
  server: Server,
): Promise<ViteDevServer> {
  const { createServer } = await import("vite");
  const port = options.port ?? 3000;
  const forceReoptimize = await linkedDistsChangedSinceLastRun(
    root,
    options.vite?.cacheDir,
    options.log ?? ((message) => console.log(message)),
  );
  return createServer({
    appType: "custom",
    clearScreen: false,
    ...options.vite,
    plugins: [
      vitePluginOption(
        figStart({
          clientNodeEnv: "development",
          emitAssets: false,
          tailwind: options.tailwind ?? false,
        }),
      ),
      vitePluginOption(
        figRefresh({
          include: /^(?!.*\.server\.[jt]sx?$).*\.[jt]sx?$/,
        }),
      ),
      figStartDevHmrPlugin(root),
      figStartLinkedDepsPlugin(),
      ...(options.vite?.plugins ?? []),
    ],
    root,
    optimizeDeps: {
      ...(forceReoptimize ? { force: true } : {}),
      ...options.vite?.optimizeDeps,
      include: [
        ...FIG_START_PREBUNDLED_PACKAGES,
        ...(options.vite?.optimizeDeps?.include ?? []),
      ],
    },
    resolve: {
      ...options.vite?.resolve,
      dedupe: [
        ...FIG_START_EXTERNAL_PACKAGES,
        ...(options.vite?.resolve?.dedupe ?? []),
      ],
    },
    server: {
      ...options.vite?.server,
      hmr: viteHmrOptions(options, server),
      middlewareMode: true,
      port,
    },
    ssr: {
      ...options.vite?.ssr,
      external: [
        ...FIG_START_EXTERNAL_PACKAGES,
        ...stringListOption(options.vite?.ssr?.external),
      ],
    },
  });
}

function viteHmrOptions(
  options: StartViteDevServerOptions,
  server: Server,
): HmrOptions | false {
  const userHmr = options.vite?.server?.hmr;
  if (userHmr === false) return false;

  const userOptions =
    typeof userHmr === "object" && userHmr !== null ? userHmr : {};

  return {
    ...publicUrlHmrOptions(options.publicUrl),
    ...userOptions,
    server: userOptions.server ?? server,
  };
}

function publicUrlHmrOptions(
  publicUrl: string | undefined,
): Pick<HmrOptions, "clientPort" | "host" | "protocol"> {
  if (publicUrl === undefined) return {};

  const url = parsePublicUrl(publicUrl);
  if (url === null) return {};
  const clientPort = hmrClientPort(url);

  return {
    ...(clientPort === undefined ? {} : { clientPort }),
    host: url.hostname,
    protocol: url.protocol === "https:" ? "wss" : "ws",
  };
}

function parsePublicUrl(publicUrl: string): URL | null {
  try {
    return new URL(publicUrl);
  } catch {
    return null;
  }
}

function hmrClientPort(url: URL): number | undefined {
  if (url.port !== "") return Number(url.port);
  if (url.protocol === "https:") return 443;
  if (url.protocol === "http:") return 80;
  return undefined;
}

function vitePluginOption(
  plugin: FigStartPlugin | FigVitePlugin,
): PluginOption {
  return plugin as unknown as PluginOption;
}

function stringListOption(
  value: true | readonly string[] | undefined,
): string[] {
  return Array.isArray(value) ? [...value] : [];
}

interface FigStartDevHmrPlugin {
  handleHotUpdate(context: HmrContext): void | [];
  name: string;
}

interface DevHotUpdate {
  action: "full-reload" | "server-update";
  message?: DevServerUpdateMessage;
}

function figStartDevHmrPlugin(root: string): FigStartDevHmrPlugin {
  return {
    name: "fig-start:dev-hmr",
    handleHotUpdate(context) {
      const update = devHotUpdateForFile(root, context.file);
      if (update === null) return undefined;

      if (update.action === "full-reload") {
        context.server.ws.send({ path: "*", type: "full-reload" });
        return [];
      }

      context.server.ws.send(DEV_SERVER_UPDATE_EVENT, update.message);
      return [];
    },
  };
}

interface FigStartLinkedDepsPlugin {
  configureServer(server: ViteDevServer): void;
  name: string;
}

// The dep optimizer caches prebundled packages by lockfile and config hash,
// so a rebuild of a workspace-linked package writes new dist files the
// running server never re-reads. Watch the linked packages' dist
// directories and force a re-optimizing restart when they change.
function figStartLinkedDepsPlugin(): FigStartLinkedDepsPlugin {
  return {
    name: "fig-start:linked-deps",
    configureServer(server) {
      void watchLinkedPrebundledPackages(server);
    },
  };
}

async function watchLinkedPrebundledPackages(
  server: ViteDevServer,
): Promise<void> {
  const directories = await linkedPrebundledPackageDirs(server);
  if (directories.length === 0) return;

  for (const directory of directories) server.watcher.add(directory);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const onFileEvent = (file: string): void => {
    if (!directories.some((directory) => file.startsWith(`${directory}/`))) {
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      server.config.logger.info(
        "Fig packages rebuilt; restarting with fresh prebundled dependencies.",
        { timestamp: true },
      );
      void server.restart(true);
    }, 200);
  };
  server.watcher.on("add", onFileEvent);
  server.watcher.on("change", onFileEvent);
}

async function linkedPrebundledPackageDirs(
  server: ViteDevServer,
): Promise<string[]> {
  const resolveId = server.config.createResolver();
  const directories = new Set<string>();

  const linkedEntryDir = async (
    id: string,
    importer?: string,
  ): Promise<string | null> => {
    const resolved = await resolveId(id, importer).catch(() => undefined);
    if (resolved === undefined) return null;
    const file = await realpath(resolved.split("?")[0] ?? resolved).catch(
      () => null,
    );
    if (file === null || file.includes("/node_modules/")) return null;
    const directory = dirname(file);
    directories.add(directory);
    return directory;
  };

  await linkedEntryDir("@bgub/fig");
  await linkedEntryDir("@bgub/fig-server/payload");
  const figDom = await linkedEntryDir("@bgub/fig-dom");
  const figStart = await linkedEntryDir("@bgub/fig-start/client");
  if (figDom !== null) {
    await linkedEntryDir("@bgub/fig-reconciler", `${figDom}/index.js`);
  }
  if (figStart !== null) {
    // fig-start itself is not prebundled (watched through the module graph),
    // but it is the resolution scope that reaches fig-devtools.
    directories.delete(figStart);
    await linkedEntryDir("@bgub/fig-devtools", `${figStart}/client.js`);
  }

  return [...directories];
}

// The dep optimizer's cache key covers the lockfile and config, not the
// contents of workspace-linked dists — so a cold start after `pnpm build`
// rewrote those dists happily serves stale prebundled chunks (mixed package
// generations show up as hydration mismatches and dead DevTools). Fingerprint
// the linked dist directories and force one re-optimization whenever the
// fingerprint differs from the previous run's. The in-session watcher above
// covers rebuilds while the server is running.
export async function linkedDistsChangedSinceLastRun(
  root: string,
  cacheDir: string | undefined,
  log: (message: string) => void,
): Promise<boolean> {
  const fingerprint = await linkedDistFingerprint(root);
  if (fingerprint === null) return false;

  const markerDir = cacheDir ?? join(root, "node_modules", ".vite");
  const markerPath = join(markerDir, "fig-start-linked-dists.json");
  const previous = await readFile(markerPath, "utf8").catch(() => null);

  if (previous === fingerprint) return false;

  await mkdir(markerDir, { recursive: true }).catch(() => undefined);
  await writeFile(markerPath, fingerprint).catch(() => undefined);
  if (previous !== null) {
    log(
      "Fig package dists changed since the last dev run; re-optimizing prebundled dependencies.",
    );
  }
  return previous !== null;
}

// Resolves the workspace-linked Fig packages the prebundle list reaches and
// hashes their dist file listings (path, size, mtime). Follows the same
// resolution chain as linkedPrebundledPackageDirs, but through plain fs so it
// can run before the Vite server exists.
async function linkedDistFingerprint(root: string): Promise<string | null> {
  const directories = new Set<string>();

  const linkedPackageDist = async (
    from: string,
    name: string,
  ): Promise<string | null> => {
    const packageDir = await realpath(join(from, "node_modules", name)).catch(
      () => null,
    );
    if (packageDir === null || packageDir.includes("/node_modules/")) {
      return null;
    }
    directories.add(join(packageDir, "dist"));
    return packageDir;
  };

  await linkedPackageDist(root, "@bgub/fig");
  await linkedPackageDist(root, "@bgub/fig-server");
  const figDom = await linkedPackageDist(root, "@bgub/fig-dom");
  const figStart = await linkedPackageDist(root, "@bgub/fig-start");
  if (figDom !== null) {
    await linkedPackageDist(figDom, "@bgub/fig-reconciler");
  }
  if (figStart !== null) {
    await linkedPackageDist(figStart, "@bgub/fig-devtools");
  }

  if (directories.size === 0) return null;

  const lines: string[] = [];
  for (const directory of [...directories].sort()) {
    const entries = await readdir(directory).catch(() => null);
    if (entries === null) continue;
    for (const entry of entries.sort()) {
      const file = join(directory, entry);
      const stats = await stat(file).catch(() => null);
      if (stats === null || !stats.isFile()) continue;
      lines.push(`${file}\n${stats.size}\n${Math.floor(stats.mtimeMs)}`);
    }
  }
  if (lines.length === 0) return null;

  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function devHotUpdateForFile(
  root: string,
  file: string,
): DevHotUpdate | null {
  const path = rootRelative(root, file);
  if (!path.startsWith("/src/")) return null;
  if (!isJavaScriptModulePath(path)) return null;

  if (path === "/src/start.ts" || path === "/src/start.tsx") {
    return { action: "full-reload" };
  }
  if (path === "/src/routes.ts" || path === "/src/routes.tsx") {
    return { action: "full-reload" };
  }
  if (!isServerModulePath(path)) return null;

  return {
    action: "server-update",
    message: { kind: "server", path },
  };
}

function isJavaScriptModulePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(path);
}

function isServerModulePath(path: string): boolean {
  return /\.server\.[jt]sx?$/i.test(path);
}

function createViteStartHandler(input: {
  clientEntry: string;
  root: string;
  tailwind: FigStartPluginOptions["tailwind"];
  vite: ViteDevServer;
}): StartHandler {
  return async (request) => {
    const viteResponse = await handleViteModuleRequest(
      input.vite,
      input.clientEntry,
      input.root,
      input.tailwind,
      request,
    );
    if (viteResponse !== null) return viteResponse;

    const modules = await loadStartDevModules(input.vite);
    const handler = createRequestHandler(
      startHandlerOptions(modules.start, modules.manifest, modules.data, {
        clientEntry: input.clientEntry,
      }),
    );
    return handler(request);
  };
}

async function handleViteModuleRequest(
  vite: ViteDevServer,
  clientEntry: string,
  root: string,
  tailwind: FigStartPluginOptions["tailwind"],
  request: Request,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const stylesheet = await serveDevStylesheet(
    root,
    tailwind,
    request,
    url,
    request.method === "HEAD",
  );
  if (stylesheet !== null) return stylesheet;

  const rawSourceAsset = await serveRawSourceAsset(
    root,
    request,
    url,
    request.method === "HEAD",
  );
  if (rawSourceAsset !== null) return rawSourceAsset;

  const generatedStaticAsset = await serveGeneratedStaticAsset(
    root,
    url,
    request.method === "HEAD",
  );
  if (generatedStaticAsset !== null) return generatedStaticAsset;

  const staticAssetModule = serveDevStaticAssetModule(
    root,
    url,
    request.method === "HEAD",
  );
  if (staticAssetModule !== null) return staticAssetModule;

  const cssModuleScript = await serveDevCssModuleScript(
    root,
    request,
    url,
    request.method === "HEAD",
  );
  if (cssModuleScript !== null) return cssModuleScript;

  const transformId = await viteTransformId(root, url, clientEntry);
  if (transformId === null) return null;

  const result = await vite.transformRequest(transformId);
  if (result === null) return null;

  return transformedResponse(result, transformId, request.method === "HEAD");
}

async function viteTransformId(
  root: string,
  url: URL,
  clientEntry: string,
): Promise<string | null> {
  const pathname = url.pathname;
  if (pathname === requestPathname(clientEntry)) return CLIENT_ENTRY_ID;
  if (pathname.startsWith("/@id/")) {
    return decodeViteId(pathname.slice("/@id/".length), url.search);
  }
  const devStylesheet = await devStylesheetId(root, pathname);
  if (devStylesheet !== null) return `${devStylesheet}${url.search}`;
  if (pathname.startsWith("/@") || pathname.startsWith("/src/")) {
    return `${pathname}${url.search}`;
  }
  if (pathname === DATA_ENDPOINT_PATH) return null;
  return isModuleLikePath(pathname) ? `${pathname}${url.search}` : null;
}

function decodeViteId(pathname: string, search: string): string {
  return `${pathname.replace(/^__x00__/, "\0")}${search}`;
}

function isModuleLikePath(pathname: string): boolean {
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  return (
    /\.(?:css|js|jsx|mjs|ts|tsx)$/i.test(name) || isServableAssetPath(name)
  );
}

async function devStylesheetId(
  root: string,
  pathname: string,
): Promise<string | null> {
  if (pathname.startsWith("/src/") && pathname.endsWith(".css")) {
    return pathname;
  }
  const stylesheets = await sourceStylesheetHrefsForModule(
    root,
    "/src/start.tsx",
  );
  if (stylesheets.includes(pathname)) return pathname;
  if (pathname === "/style.css" && stylesheets.length === 1) {
    return stylesheets[0] ?? null;
  }
  return null;
}

async function serveDevStylesheet(
  root: string,
  tailwind: FigStartPluginOptions["tailwind"],
  request: Request,
  url: URL,
  headOnly: boolean,
): Promise<Response | null> {
  if (!isStylesheetRequest(request, url)) return null;

  const href = await devStylesheetId(root, url.pathname);
  if (href === null) return null;

  const file = resolve(root, href.slice(1));
  if (!isInside(root, file)) return null;

  const css = file.endsWith(".module.css")
    ? (await renderCssModuleStyles(root, file)).css
    : await renderGlobalCss(root, tailwind, file);

  return new Response(headOnly ? null : css, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/css; charset=utf-8",
    },
    status: 200,
  });
}

async function serveDevCssModuleScript(
  root: string,
  request: Request,
  url: URL,
  headOnly: boolean,
): Promise<Response | null> {
  if (
    isStylesheetRequest(request, url) ||
    !url.pathname.endsWith(".module.css")
  ) {
    return null;
  }

  const file = resolve(root, url.pathname.slice(1));
  if (!isInside(root, file)) return null;

  const { classes } = await renderCssModuleStyles(root, file);
  return new Response(
    headOnly
      ? null
      : `const classes = ${JSON.stringify(classes)};\nexport default classes;\n`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      },
      status: 200,
    },
  );
}

function isStylesheetRequest(request: Request, url: URL): boolean {
  if (url.pathname === "/style.css") return true;

  const destination = request.headers.get("sec-fetch-dest");
  if (destination !== null) return destination === "style";

  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/css");
}

async function renderGlobalCss(
  root: string,
  tailwind: FigStartPluginOptions["tailwind"],
  id: string,
): Promise<string> {
  const source = await readFile(id, "utf8");
  if (
    tailwind === false ||
    tailwind === undefined ||
    !isTailwindCssEntry(source)
  ) {
    return source;
  }
  const result = await transformTailwindCss(source, id, root, tailwind);
  return result.code;
}

async function sourceStylesheetHrefsForModule(
  root: string,
  specifier: string,
): Promise<string[]> {
  const file = resolve(root, specifier.slice(1));
  const code = await readFile(file, "utf8").catch(() => "");
  const hrefs: string[] = [];

  for (const source of assetImportSpecifiers(code)) {
    if (!isCssSpecifier(source)) continue;
    const id = rootAbsolutePathForImport(root, specifier, source);
    if (id !== null) hrefs.push(rootRelative(root, id));
  }

  return [...new Set(hrefs)];
}

async function serveRawSourceAsset(
  root: string,
  request: Request,
  url: URL,
  headOnly: boolean,
): Promise<Response | null> {
  const pathname = requestPathname(url.href);
  if (!isRawSourceAssetRequest(request, url, pathname)) return null;

  const file = resolve(root, pathname.slice(1));
  if (!isInside(root, file)) return null;

  const content = await readFile(file).catch(() => null);
  if (content === null) return null;

  return new Response(headOnly ? null : new Uint8Array(content), {
    headers: {
      "cache-control": "no-store",
      "content-type": contentTypeFor(file),
    },
    status: 200,
  });
}

function isRawSourceAssetRequest(
  request: Request,
  url: URL,
  pathname: string,
): boolean {
  if (!isRawSourceAssetPath(pathname)) return false;
  if (url.searchParams.has("import")) return false;

  const destination = request.headers.get("sec-fetch-dest");
  if (destination !== null) {
    return (
      destination === "audio" ||
      destination === "font" ||
      destination === "image" ||
      destination === "video"
    );
  }

  const accept = request.headers.get("accept") ?? "";
  return (
    accept === "" ||
    accept === "*/*" ||
    accept.includes("font/") ||
    accept.includes("image/") ||
    accept.includes("video/")
  );
}

function isRawSourceAssetPath(pathname: string): boolean {
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  return (
    pathname.startsWith("/src/") &&
    isServableAssetPath(name) &&
    !/\.(?:css|js|jsx|mjs|ts|tsx)$/i.test(name)
  );
}

function serveDevStaticAssetModule(
  root: string,
  url: URL,
  headOnly: boolean,
): Response | null {
  if (!url.searchParams.has("import")) return null;

  const pathname = requestPathname(url.href);
  if (!isRawSourceAssetPath(pathname)) return null;

  const file = resolve(root, pathname.slice(1));
  if (!isInside(root, file)) return null;

  return new Response(
    headOnly
      ? null
      : `export default ${JSON.stringify(staticAssetHref(root, file))};\n`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      },
      status: 200,
    },
  );
}

async function serveGeneratedStaticAsset(
  root: string,
  url: URL,
  headOnly: boolean,
): Promise<Response | null> {
  const pathname = requestPathname(url.href);
  if (!pathname.startsWith("/fig-start/")) return null;

  const file = await findGeneratedStaticAsset(root, pathname);
  if (file === null) return null;

  const content = await readFile(file).catch(() => null);
  if (content === null) return null;

  return new Response(headOnly ? null : new Uint8Array(content), {
    headers: {
      "cache-control": "no-store",
      "content-type": contentTypeFor(file),
    },
    status: 200,
  });
}

async function findGeneratedStaticAsset(
  root: string,
  pathname: string,
): Promise<string | null> {
  const sourceRoot = resolve(root, "src");

  for (const file of await sourceStaticAssetFiles(root, sourceRoot)) {
    if (staticAssetHref(root, file) === pathname) return file;
  }

  return null;
}

async function sourceStaticAssetFiles(
  root: string,
  directory: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];

  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceStaticAssetFiles(root, file)));
    } else if (isRawSourceAssetPath(rootRelative(root, file))) {
      files.push(file);
    }
  }

  return files;
}

function isInside(root: string, file: string): boolean {
  return (
    file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`)
  );
}

function transformedResponse(
  result: ViteTransformResult,
  _id: string,
  headOnly: boolean,
): Response {
  return new Response(headOnly ? null : result.code, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    },
    status: 200,
  });
}

async function loadStartDevModules(vite: ViteDevServer): Promise<{
  data: ServerDataResourcesModule;
  manifest: ServerManifestModule;
  start: StartConfig;
}> {
  const [startModule, manifest, data] = await Promise.all([
    vite.ssrLoadModule("/src/start.tsx"),
    vite.ssrLoadModule(SERVER_MANIFEST_ID),
    vite.ssrLoadModule(SERVER_DATA_RESOURCES_ID),
  ]);

  return {
    data: serverDataResourcesModule(data),
    manifest: serverManifestModule(manifest),
    start: startModuleConfig(startModule).start,
  };
}

function startHandlerOptions(
  start: StartConfig,
  manifest: ServerManifestModule,
  data: ServerDataResourcesModule,
  input: { clientEntry: string },
): StartHandlerOptions {
  const {
    appName,
    clientReferenceAssets: appClientReferenceAssets,
    context: appContext,
    onRecoverableError: _onRecoverableError,
    serverRouteAssets: appServerRouteAssets,
    ...serverOptions
  } = start;

  async function context(request: Request): Promise<unknown> {
    const requestContext = await appContext?.(request);
    return requestContext === null || typeof requestContext !== "object"
      ? { appName }
      : { appName, ...requestContext };
  }

  return {
    ...serverOptions,
    clientEntry: input.clientEntry,
    clientReferenceAssets: (metadata) =>
      mergeAssetResources(
        manifest.resolveClientReferenceAssets(metadata),
        appClientReferenceAssets?.(metadata),
      ),
    context,
    serverDataResources: data.serverDataResources,
    serverRouteAssets: (metadata) =>
      mergeAssetResources(
        manifest.resolveServerRouteAssets(metadata),
        appServerRouteAssets?.(metadata),
      ),
  };
}

function mergeAssetResources(
  generated: FigAssetResourceList,
  app: FigAssetResourceList | undefined,
): FigAssetResourceList {
  if (app === undefined) return generated;
  return [...toAssetResourceArray(generated), ...toAssetResourceArray(app)];
}

function toAssetResourceArray(
  resources: FigAssetResourceList,
): readonly FigAssetResource[] {
  return isAssetResourceArray(resources) ? resources : [resources];
}

function isAssetResourceArray(
  resources: FigAssetResourceList,
): resources is readonly FigAssetResource[] {
  return Array.isArray(resources);
}

function startModuleConfig(value: unknown): StartModule {
  if (!isRecord(value) || !isStartConfig(value.start)) {
    throw new Error('Expected "/src/start.tsx" to export a Fig Start config.');
  }
  return { start: value.start };
}

function isStartConfig(value: unknown): value is StartConfig {
  return (
    isRecord(value) &&
    typeof value.appName === "string" &&
    Array.isArray(value.routes)
  );
}

function serverManifestModule(value: unknown): ServerManifestModule {
  if (
    !isRecord(value) ||
    !isAssetResourceResolver(value.resolveClientReferenceAssets) ||
    !isAssetResourceResolver(value.resolveServerRouteAssets)
  ) {
    throw new Error("Expected the Fig Start server manifest module.");
  }
  const resolveClientReferenceAssets = value.resolveClientReferenceAssets;
  const resolveServerRouteAssets = value.resolveServerRouteAssets;
  return {
    resolveClientReferenceAssets: (metadata) =>
      figAssetResourceList(resolveClientReferenceAssets(metadata)),
    resolveServerRouteAssets: (metadata) =>
      figAssetResourceList(resolveServerRouteAssets(metadata)),
  };
}

function serverDataResourcesModule(value: unknown): ServerDataResourcesModule {
  if (!isRecord(value) || !isRecord(value.serverDataResources)) {
    throw new Error("Expected the Fig Start server data resources module.");
  }
  return { serverDataResources: value.serverDataResources };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetResourceResolver(
  value: unknown,
): value is (metadata: { id: string }) => unknown {
  return typeof value === "function";
}

function figAssetResourceList(value: unknown): FigAssetResourceList {
  if (Array.isArray(value)) return value.filter(isFigAssetResource);
  return isFigAssetResource(value) ? value : [];
}

function isFigAssetResource(value: unknown): value is FigAssetResource {
  return isRecord(value) && typeof value.kind === "string";
}
