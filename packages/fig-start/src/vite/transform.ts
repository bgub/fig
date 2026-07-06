import { dirname, resolve } from "node:path";
import babel, { type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";
import {
  type ClientDataResourceStub,
  collectServerDataResourceStubs,
  discoverServerDataResources,
  type ServerDataResourceRef,
} from "../../../fig-vite/src/data/index.ts";
import { rootRelative } from "./path-utils.ts";

// The callee that declares a Fig Start remote server resource. Fig's data
// layer has no remote concept: the framework owns the name, the endpoint registry, and
// the browser stub emission below.
export const REMOTE_DATA_RESOURCE_CALLEE = "remoteDataResource";
const REMOTE_DATA_RESOURCE_MODULE = "@bgub/fig-start/server";

export interface ClientRef {
  // Stable id ("<root-relative-path>#<Export>") shared by the server transform
  // and the client manifest (both go through this module, so ids always match).
  id: string;
  // Public CSS asset URLs emitted for this client module.
  css?: string[];
  // Root-relative module path the client manifest imports for this reference.
  specifier: string;
}

export interface ServerTransformResult {
  clientRefs: ClientRef[];
  code: string;
  marksServerRoute: boolean;
  map: unknown;
  serverDataResources: ServerDataResourceRef[];
  serverRouteId: string | null;
}

export interface ClientRouteStubResult {
  code: string;
  map: unknown;
  routePath: string | null;
}

export function clientRefId(specifier: string, exportName: string): string {
  return `${specifier}#${exportName}`;
}

function isClientModule(source: string): boolean {
  return source.endsWith(".tsx") && !source.endsWith(".server.tsx");
}

// Transform a `.server.tsx` module: rewrite each `.tsx` import binding into a
// Fig clientReference (the server only reads its id; the client loads it via the
// manifest). Returns null-equivalent (empty clientRefs) when nothing to rewrite.
export async function transformServerModule(
  code: string,
  id: string,
  root: string,
): Promise<ServerTransformResult> {
  const importerDir = dirname(id.split("?")[0] ?? id);
  const clientRefs: ClientRef[] = [];
  let marksServerRoute = false;
  let serverRouteId: string | null = null;

  const result = await transformTypeScript(code, id, {
    plugins: [
      serverComponentBabelPlugin({
        clientRefs,
        importerDir,
        markServerRoute: () => {
          marksServerRoute = true;
        },
        setServerRouteId: (id) => {
          serverRouteId = id;
        },
        root,
      }),
    ],
    sourceMaps: true,
  });
  const serverDataResources = await discoverServerDataResources(
    code,
    id,
    root,
    REMOTE_DATA_RESOURCE_CALLEE,
  );

  return {
    clientRefs,
    code: result?.code ?? code,
    marksServerRoute,
    map: result?.map,
    serverDataResources,
    serverRouteId,
  };
}

export async function transformServerRouteClientStub(
  code: string,
  id: string,
  root: string,
): Promise<ClientRouteStubResult> {
  let routePath: string | null = null;

  await transformTypeScript(code, id, {
    plugins: [
      clientStubDiscoveryBabelPlugin({
        setRoutePath: (path) => (routePath = path),
      }),
    ],
    sourceMaps: false,
  });
  const serverStubs = await collectServerDataResourceStubs(code, id, root);
  const remoteStubs = await collectServerDataResourceStubs(
    code,
    id,
    root,
    REMOTE_DATA_RESOURCE_CALLEE,
  );

  if (
    routePath === null &&
    serverStubs.length === 0 &&
    remoteStubs.length === 0
  ) {
    const stubCode =
      `throw new Error(${JSON.stringify(
        `Cannot import server module "${id}" in a browser bundle.`,
      )});\n` + `export {};`;
    return {
      code: stubCode,
      map: generatedSourceMap(id, stubCode),
      routePath,
    };
  }

  const stubCode = [
    routePath === null ? "" : routeStubCode(routePath),
    serverStubs.length === 0 && remoteStubs.length === 0
      ? ""
      : dataStubCode(serverStubs, remoteStubs),
  ]
    .filter((part) => part.length > 0)
    .join("");
  return {
    code: stubCode,
    map: generatedSourceMap(id, stubCode),
    routePath,
  };
}

// Browser stubs for a .server module's data resources. serverDataResource
// declarations keep only their browser-safe key (hydrate-only);
// remoteDataResource declarations become plain loader-backed resources whose
// loader closes over the generated id and calls the framework data endpoint.
function dataStubCode(
  serverStubs: readonly ClientDataResourceStub[],
  remoteStubs: readonly ClientDataResourceStub[],
): string {
  const imports = new Set<string>();
  const exports: string[] = [];

  for (const stub of [...serverStubs, ...remoteStubs]) {
    for (const code of stub.importCodes) imports.add(code);
  }
  imports.add(`import { dataResource as __figDataResource } from "@bgub/fig";`);
  if (remoteStubs.length > 0) {
    imports.add(
      `import { remoteDataLoader as __figRemoteDataLoader } from "@bgub/fig-start/client";`,
    );
  }

  for (const stub of serverStubs) {
    exports.push(
      `export const ${stub.exportName} = __figDataResource({ ${dataStubFields(
        stub,
      ).join(", ")} });`,
    );
  }
  for (const stub of remoteStubs) {
    const fields = [
      ...dataStubFields(stub),
      `load: __figRemoteDataLoader(${JSON.stringify(stub.id)})`,
    ];
    exports.push(
      `export const ${stub.exportName} = __figDataResource({ ${fields.join(
        ", ",
      )} });`,
    );
  }

  return `${[...imports].join("\n")}\n${exports.join("\n")}\n`;
}

function dataStubFields(stub: ClientDataResourceStub): string[] {
  const fields = [`key: ${stub.keyCode}`];
  if (stub.debugArgsCode !== undefined) {
    fields.push(`debugArgs: ${stub.debugArgsCode}`);
  }
  return fields;
}

// remoteDataResource declares a public endpoint, so its declarations must
// stay inside .server.ts(x) modules where the transform can see and strip
// them. Importing it anywhere else fails the build.
export async function assertNoRemoteDataResourceImport(
  code: string,
  id: string,
): Promise<void> {
  await transformTypeScript(code, id, {
    plugins: [remoteDataResourceImportGuardBabelPlugin(id)],
    sourceMaps: false,
  });
}

function remoteDataResourceImportGuardBabelPlugin(
  id: string,
): (api: typeof babel) => PluginObj {
  return (api) => {
    void api;
    const error =
      `remoteDataResource may only be imported from .server.ts or ` +
      `.server.tsx files. Move "${id}" to a .server.ts(x) file.`;

    return {
      name: "fig-start-remote-data-resource-import-guard",
      visitor: {
        ImportDeclaration(path) {
          if (path.node.source.value !== REMOTE_DATA_RESOURCE_MODULE) return;
          if (path.node.importKind === "type") return;
          for (const specifier of path.node.specifiers) {
            if (specifier.type !== "ImportSpecifier") continue;
            if ("importKind" in specifier && specifier.importKind === "type") {
              continue;
            }
            const imported = specifier.imported;
            const name =
              imported.type === "Identifier" ? imported.name : imported.value;
            if (name === REMOTE_DATA_RESOURCE_CALLEE) {
              throw path.buildCodeFrameError(error);
            }
          }
        },
      },
    };
  };
}

function routeStubCode(routePath: string): string {
  return (
    `import { createFileRoute } from "@bgub/fig-start";\n` +
    `import { markServerRoute as __figMarkServerRoute } from "@bgub/fig-start/internal";\n` +
    `export const Route = __figMarkServerRoute(createFileRoute(${JSON.stringify(
      routePath,
    )})());\n`
  );
}

function generatedSourceMap(
  id: string,
  code: string,
): {
  mappings: "";
  names: [];
  sources: [string];
  sourcesContent: [string];
  version: 3;
} {
  return {
    mappings: "",
    names: [],
    sources: [`${id}?fig-start-client-stub`],
    sourcesContent: [code],
    version: 3,
  };
}

function transformTypeScript(
  code: string,
  id: string,
  options: {
    plugins: Array<(api: typeof babel) => PluginObj>;
    sourceMaps: boolean;
  },
): Promise<babel.BabelFileResult | null> {
  return babel.transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: id,
    sourceMaps: options.sourceMaps,
    presets: [
      [
        presetTypescript,
        { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true },
      ],
    ],
    plugins: options.plugins,
  });
}

function serverComponentBabelPlugin(state: {
  clientRefs: ClientRef[];
  importerDir: string;
  markServerRoute: () => void;
  root: string;
  setServerRouteId: (id: string) => void;
}): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;
    let needsClientReferenceImport = false;
    let needsServerRouteImport = false;

    return {
      name: "fig-start-server",
      visitor: {
        Program: {
          exit(path) {
            const routePath = routePathFromLocalRouteBinding(path, t);
            if (routePath !== null) {
              needsServerRouteImport = true;
              state.markServerRoute();
              state.setServerRouteId(routePath);
              path.pushContainer(
                "body",
                api.template.statement.ast("__figMarkServerRoute(Route);"),
              );
            }

            const imports = [];
            if (needsClientReferenceImport) {
              imports.push(
                api.template.statement.ast(
                  `import { serverClientReference as __figClientRef } from "@bgub/fig-start/internal";`,
                ),
              );
            }
            if (needsServerRouteImport) {
              imports.push(
                api.template.statement.ast(
                  `import { markServerRoute as __figMarkServerRoute } from "@bgub/fig-start/internal";`,
                ),
              );
            }
            path.node.body.unshift(...(imports as never[]));
          },
        },
        ImportDeclaration(path) {
          const source = path.node.source.value;
          if (!isClientModule(source)) return;

          const specifier = rootRelative(
            state.root,
            resolve(state.importerDir, source),
          );

          const declarations = [];
          for (const spec of path.node.specifiers) {
            let exportName: string;
            const publicName = spec.local.name;
            const implementation = path.scope.generateUidIdentifier(
              `figClientImpl_${publicName}`,
            );
            if (t.isImportDefaultSpecifier(spec)) {
              exportName = "default";
              spec.local = implementation;
            } else if (t.isImportSpecifier(spec)) {
              exportName = t.isIdentifier(spec.imported)
                ? spec.imported.name
                : spec.imported.value;
              spec.local = implementation;
            } else {
              // Namespace imports (import * as) of a client module can't become a
              // client reference; fail loudly instead of leaking the import across
              // the server/client boundary.
              throw path.buildCodeFrameError(
                `A .server.tsx cannot "import * as" a client module ("${source}"). ` +
                  `Import the components by name instead.`,
              );
            }

            const id = clientRefId(specifier, exportName);
            state.clientRefs.push({ id, specifier });
            declarations.push(
              api.template.statement.ast(
                `const ${publicName} = __figClientRef({ id: ${JSON.stringify(
                  id,
                )}, load: () => Promise.resolve({ ${JSON.stringify(
                  exportName,
                )}: ${implementation.name} }), ssr: ${implementation.name} });`,
              ),
            );
          }

          if (declarations.length === 0) return;
          needsClientReferenceImport = true;
          path.insertAfter(declarations as never[]);
        },
      },
    };
  };
}

function routePathFromLocalRouteBinding(
  path: babel.NodePath<babel.types.Program>,
  t: typeof babel.types,
): string | null {
  const binding = path.scope.getBinding("Route");
  if (binding === undefined) return null;
  return routePathFromBinding(binding, t);
}

function routePathFromBinding(
  binding: { path: babel.NodePath },
  t: typeof babel.types,
): string | null {
  if (binding.path.isVariableDeclarator()) {
    return routePathFromDeclarator(binding.path.node, t);
  }

  if (!binding.path.isIdentifier()) return null;
  if (!binding.path.parentPath.isVariableDeclarator()) return null;
  return routePathFromDeclarator(binding.path.parentPath.node, t);
}

function clientStubDiscoveryBabelPlugin(state: {
  setRoutePath: (path: string) => void;
}): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;

    return {
      name: "fig-start-server-route-stub",
      visitor: {
        VariableDeclarator(path) {
          const routePath = routePathFromDeclarator(path.node, t);
          if (routePath !== null) state.setRoutePath(routePath);
        },
      },
    };
  };
}

function routePathFromDeclarator(
  node: babel.types.VariableDeclarator,
  t: typeof babel.types,
): string | null {
  return t.isIdentifier(node.id, { name: "Route" })
    ? routePathFromInitializer(node.init, t)
    : null;
}

function routePathFromInitializer(
  init: babel.types.Expression | null | undefined,
  t: typeof babel.types,
): string | null {
  if (!t.isCallExpression(init)) return null;
  const createRouteCall = init.callee;
  if (!t.isCallExpression(createRouteCall)) return null;
  if (!t.isIdentifier(createRouteCall.callee, { name: "createFileRoute" })) {
    return null;
  }

  const [pathArg] = createRouteCall.arguments;
  return t.isStringLiteral(pathArg) ? pathArg.value : null;
}
