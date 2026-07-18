import { fileURLToPath } from "node:url";
import {
  START_ENVIRONMENT_NAMES,
  tanStackStartVite,
  type TanStackStartViteInputConfig,
} from "@tanstack/start-plugin-core/vite";
import type { PluginOption } from "vite";

const compatibilityFramework = "solid";
const figRouterPackage = "@bgub/fig-tanstack-router";
const figStartPackage = "@bgub/fig-tanstack-start";
const tanstackStartPackage = "@tanstack/solid-start";
const resolveDependency = (id: string) =>
  fileURLToPath(import.meta.resolve(id));
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
    code: `export { createClientRpc } from ${JSON.stringify(
      resolveDependency("@tanstack/start-client-core/client-rpc"),
    )};`,
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
  ];
}

function compatibilityPlugin(): PluginOption {
  return {
    name: "fig-tanstack-start:compatibility",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: [
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
              replacement: figStartPackage,
            },
          ],
          dedupe: [figStartPackage, figRouterPackage],
        },
      };
    },
    configEnvironment(environmentName, environment) {
      if (environmentName !== START_ENVIRONMENT_NAMES.client) return undefined;
      return {
        optimizeDeps: {
          exclude: [
            ...(environment.optimizeDeps?.exclude ?? []),
            figStartPackage,
            figRouterPackage,
            "@tanstack/start-client-core",
          ],
        },
      };
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
          `import { defaultStreamHandler } from ${JSON.stringify(`${figStartPackage}/server`)};`,
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
