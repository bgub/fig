import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  START_ENVIRONMENT_NAMES,
  tanStackStartVite,
  type TanStackStartViteInputConfig,
} from "@tanstack/start-plugin-core/vite";
import { figRefresh } from "@bgub/fig-vite";
import type { PluginOption } from "vite";

const compatibilityFramework = "solid";
const figRouterPackage = "@bgub/fig-tanstack-router";
const figTanStackStartPackage = "@bgub/fig-tanstack-start";
const tanstackStartPackage = "@tanstack/solid-start";
const tanstackStartClientPackage = "@tanstack/start-client-core";
const resolveDependency = (id: string) =>
  fileURLToPath(import.meta.resolve(id));
const tanstackStartClientModules = [
  tanstackStartClientPackage,
  `${tanstackStartClientPackage}/client`,
  `${tanstackStartClientPackage}/client-rpc`,
] as const;
const tanstackStartClientAliases = tanstackStartClientModules.map((id) => ({
  find: new RegExp(`^${id}$`),
  replacement: resolveDependency(id),
}));
const optimizedClientModules = [
  ...tanstackStartClientModules,
  "@tanstack/router-core/ssr/client",
] as const;
const applicationEntryIds = new Set([
  "#tanstack-router-entry",
  "#tanstack-start-entry",
]);
const storageContextPath = fileURLToPath(
  new URL("../storage-context.js", import.meta.url),
);

const defaultEntryPaths = {
  client: fileURLToPath(new URL("../default-entry/client.js", import.meta.url)),
  server: fileURLToPath(new URL("../default-entry/server.js", import.meta.url)),
  start: fileURLToPath(new URL("../default-entry/start.js", import.meta.url)),
} as const;

const compilerRpcModules = [
  {
    source: `${tanstackStartPackage}/client-rpc`,
    id: "\0fig-tanstack-start:client-rpc",
    code: `export { createClientRpc } from "${tanstackStartClientPackage}/client-rpc";`,
  },
  {
    source: `${tanstackStartPackage}/server-rpc`,
    id: "\0fig-tanstack-start:server-rpc",
    code: `export { createServerRpc } from ${JSON.stringify(
      resolveDependency("@tanstack/start-server-core/createServerRpc"),
    )};`,
  },
  {
    source: `${tanstackStartPackage}/ssr-rpc`,
    id: "\0fig-tanstack-start:ssr-rpc",
    code: `export { createSsrRpc } from ${JSON.stringify(
      resolveDependency("@tanstack/start-server-core/createSsrRpc"),
    )};`,
  },
] as const;

export function tanstackStart(
  options?: TanStackStartViteInputConfig,
): PluginOption[] {
  const startOptions: TanStackStartViteInputConfig = {
    ...options,
    start: {
      ...options?.start,
      entry: options?.start?.entry ?? "start",
    },
  };
  return [
    compatibilityPlugin(),
    tanStackStartVite(
      {
        defaultEntryPaths,
        framework: compatibilityFramework,
        providerEnvironmentName: START_ENVIRONMENT_NAMES.server,
        ssrIsProvider: true,
        ssrResolverStrategy: { type: "default" },
      },
      startOptions,
    ),
    // Route splitting must run first: it moves component declarations into
    // virtual modules. Refresh then registers the declarations where they
    // actually remain instead of leaving references in the route shell.
    figRefresh(),
  ];
}

function compatibilityPlugin(): PluginOption {
  let clientOutDir: string | undefined;
  let serverAssetsPrefix = "assets/";
  const applicationEntryUrls = new Map<string, string>();
  const optimizerApplicationEntries = {
    name: "fig-tanstack-start:optimizer-application-entries",
    resolveId(source: string) {
      const id = applicationEntryUrls.get(source);
      return id === undefined ? null : { external: true, id };
    },
  };
  return {
    name: "fig-tanstack-start:compatibility",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: [
            ...tanstackStartClientAliases,
            {
              find: /^@tanstack\/start-storage-context$/,
              replacement: storageContextPath,
            },
            {
              find: /^@tanstack\/solid-router$/,
              replacement: figRouterPackage,
            },
            {
              find: /^@tanstack\/solid-start$/,
              replacement: figTanStackStartPackage,
            },
          ],
          dedupe: [figTanStackStartPackage, figRouterPackage],
        },
      };
    },
    configEnvironment(environmentName, environment) {
      if (environmentName === START_ENVIRONMENT_NAMES.server) {
        return { build: { emitAssets: true } };
      }
      if (environmentName !== START_ENVIRONMENT_NAMES.client) return undefined;
      const optimizerPlugins =
        environment.optimizeDeps?.rolldownOptions?.plugins;
      return {
        optimizeDeps: {
          include: [
            ...(environment.optimizeDeps?.include ?? []),
            ...optimizedClientModules,
          ],
          exclude: [
            ...(environment.optimizeDeps?.exclude ?? []),
            figTanStackStartPackage,
            figRouterPackage,
          ],
          rolldownOptions: {
            ...environment.optimizeDeps?.rolldownOptions,
            plugins: [
              ...(optimizerPlugins === undefined ? [] : [optimizerPlugins]),
              optimizerApplicationEntries,
            ],
          },
        },
      };
    },
    configResolved(config) {
      for (const alias of config.resolve.alias) {
        if (
          typeof alias.find === "string" &&
          applicationEntryIds.has(alias.find)
        ) {
          applicationEntryUrls.set(alias.find, viteFsImport(alias.replacement));
        }
      }
      const outDir =
        config.environments[START_ENVIRONMENT_NAMES.client]?.build.outDir;
      if (outDir !== undefined) clientOutDir = resolve(config.root, outDir);
      const assetsDir =
        config.environments[START_ENVIRONMENT_NAMES.server]?.build.assetsDir;
      if (assetsDir !== undefined) {
        const normalized = assetsDir.replace(/\/+$/, "");
        serverAssetsPrefix = normalized === "" ? "" : `${normalized}/`;
      }
    },
    async writeBundle(_options, bundle) {
      if (
        this.environment.name !== START_ENVIRONMENT_NAMES.server ||
        clientOutDir === undefined
      ) {
        return;
      }

      const publicOutDir = clientOutDir;
      await Promise.all(
        Object.values(bundle).map(async (output) => {
          if (
            output.type !== "asset" ||
            !output.fileName.startsWith(serverAssetsPrefix) ||
            output.fileName.endsWith(".map")
          ) {
            return;
          }
          const path = resolve(publicOutDir, output.fileName);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, output.source);
        }),
      );
    },
    resolveId(source) {
      return compilerRpcModules.find((module) => module.source === source)?.id;
    },
    load(id) {
      const rpcModule = compilerRpcModules.find((module) => module.id === id);
      if (rpcModule !== undefined) {
        return rpcModule.code;
      }
      if (id === defaultEntryPaths.server) {
        return [
          'import { createStartHandler } from "@tanstack/start-server-core";',
          `import { defaultStreamHandler } from ${JSON.stringify(`${figTanStackStartPackage}/server`)};`,
          "const fetch = createStartHandler(defaultStreamHandler);",
          "export default { fetch };",
        ].join("\n");
      }
      return undefined;
    },
    transform(code) {
      const rewritten = rewriteFrameworkImports(code);
      return rewritten === code ? undefined : { code: rewritten, map: null };
    },
  };
}

function rewriteFrameworkImports(code: string): string {
  return code.replace(
    /\b(from|import)\s*(\(\s*)?(["'])@bgub\/fig-tanstack-start\3/g,
    (_match, keyword: string, parenthesis: string | undefined, quote: string) =>
      `${keyword}${parenthesis === undefined ? " " : parenthesis}${quote}${tanstackStartPackage}${quote}`,
  );
}

function viteFsImport(path: string): string {
  return `/@fs/${path.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}
