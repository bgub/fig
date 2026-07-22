import { fileURLToPath } from "node:url";
import { START_ENVIRONMENT_NAMES } from "@tanstack/start-plugin-core/vite";
import type { PluginOption } from "vite";
import { toViteFsPath } from "./module-ids.ts";
import {
  createCompilerRpcModules,
  createDefaultServerEntry,
  incompatibleRuntimeModules,
  rewriteFrameworkImports,
  tanStackCompatibilityProfile,
} from "./compatibility-profile.ts";

const {
  figRouter: figRouterPackage,
  figStart: figTanStackStartPackage,
  frameworkRouter: tanstackRouterPackage,
  frameworkStart: tanstackStartPackage,
  startClient: tanstackStartClientPackage,
} = tanStackCompatibilityProfile.packages;

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
const optimizedClientModules = ["@tanstack/router-core/ssr/client"] as const;
const applicationEntryIds = new Set([
  "#tanstack-router-entry",
  "#tanstack-start-entry",
]);
const storageContextPath = fileURLToPath(
  new URL("../storage-context.js", import.meta.url),
);

export const defaultEntryPaths = {
  client: fileURLToPath(new URL("../default-entry/client.js", import.meta.url)),
  server: fileURLToPath(new URL("../default-entry/server.js", import.meta.url)),
  start: fileURLToPath(new URL("../default-entry/start.js", import.meta.url)),
} as const;

const compilerRpcModules = createCompilerRpcModules(resolveDependency);

export function startCompatibilityPlugin(): PluginOption {
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
              find: new RegExp(`^${tanstackRouterPackage}$`),
              replacement: figRouterPackage,
            },
            {
              find: new RegExp(`^${tanstackStartPackage}$`),
              replacement: figTanStackStartPackage,
            },
          ],
          dedupe: [figTanStackStartPackage, figRouterPackage],
        },
      };
    },
    configEnvironment(environmentName, environment) {
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
            // Start's compiler must rewrite createIsomorphicFn branches per
            // environment; prebundling these first freezes server code into
            // the client graph and makes client-side server functions crash.
            ...tanstackStartClientModules,
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
          applicationEntryUrls.set(alias.find, toViteFsPath(alias.replacement));
        }
      }
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== START_ENVIRONMENT_NAMES.client) return;
      const emittedModuleIds = Object.values(bundle).flatMap((output) =>
        output.type === "chunk"
          ? Object.entries(output.modules).flatMap(([id, module]) =>
              module.renderedLength === 0 ? [] : [id],
            )
          : [],
      );
      const incompatible = incompatibleRuntimeModules(emittedModuleIds);
      if (incompatible.length === 0) return;
      throw new Error(
        `${tanStackCompatibilityProfile.id} resolved compatibility-only Solid modules into the client runtime:\n${incompatible.join("\n")}`,
      );
    },
    resolveId(source) {
      return compilerRpcModules.find((module) => module.source === source)?.id;
    },
    load(id) {
      const rpcModule = compilerRpcModules.find((module) => module.id === id);
      if (rpcModule !== undefined) return rpcModule.code;
      if (id === defaultEntryPaths.server) return createDefaultServerEntry();
      return undefined;
    },
    transform(code) {
      const rewritten = rewriteFrameworkImports(code);
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}
