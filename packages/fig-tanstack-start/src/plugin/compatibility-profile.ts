export const tanStackCompatibilityProfile = {
  id: "tanstack-start-core-1.171",
  framework: "solid",
  packages: {
    figRouter: "@bgub/fig-tanstack-router",
    figStart: "@bgub/fig-tanstack-start",
    frameworkRouter: "@tanstack/solid-router",
    frameworkStart: "@tanstack/solid-start",
    startClient: "@tanstack/start-client-core",
    startServer: "@tanstack/start-server-core",
  },
  versions: {
    routerCore: "1.171.15",
    startClientCore: "1.170.14",
    startPluginCore: "1.171.22",
    startServerCore: "1.169.17",
  },
} as const;

export function createCompilerRpcModules(
  resolveDependency: (id: string) => string,
) {
  const { frameworkStart, startClient, startServer } =
    tanStackCompatibilityProfile.packages;
  return [
    {
      source: `${frameworkStart}/client-rpc`,
      id: "\0fig-tanstack-start:client-rpc",
      code: `export { createClientRpc } from "${startClient}/client-rpc";`,
    },
    {
      source: `${frameworkStart}/server-rpc`,
      id: "\0fig-tanstack-start:server-rpc",
      code: `export { createServerRpc } from ${JSON.stringify(
        resolveDependency(`${startServer}/createServerRpc`),
      )};`,
    },
    {
      source: `${frameworkStart}/ssr-rpc`,
      id: "\0fig-tanstack-start:ssr-rpc",
      code: `export { createSsrRpc } from ${JSON.stringify(
        resolveDependency(`${startServer}/createSsrRpc`),
      )};`,
    },
  ];
}

export function createDefaultServerEntry(): string {
  const { figStart } = tanStackCompatibilityProfile.packages;
  return [
    `import { createFigStartHandler } from ${JSON.stringify(`${figStart}/server`)};`,
    "const fetch = createFigStartHandler();",
    "export default { fetch };",
  ].join("\n");
}

export function rewriteFrameworkImports(code: string): string {
  const { figStart, frameworkStart } = tanStackCompatibilityProfile.packages;
  return code.replace(
    new RegExp(
      `\\b(from|import)\\s*(\\(\\s*)?(["'])${escapeRegExp(figStart)}\\3`,
      "g",
    ),
    (_match, keyword: string, parenthesis: string | undefined, quote: string) =>
      `${keyword}${parenthesis === undefined ? " " : parenthesis}${quote}${frameworkStart}${quote}`,
  );
}

export function incompatibleRuntimeModules(
  moduleIds: Iterable<string>,
): string[] {
  const { frameworkRouter, frameworkStart } =
    tanStackCompatibilityProfile.packages;
  const forbiddenPackages = [frameworkRouter, frameworkStart];
  return [...moduleIds].filter((id) => {
    const normalized = id.replaceAll("\\", "/");
    return forbiddenPackages.some((packageName) =>
      normalized.includes(`/node_modules/${packageName}/`),
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
