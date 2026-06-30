import { dirname, relative, resolve, sep } from "node:path";
import babel, { type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

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
  serverRouteId: string | null;
}

export interface ClientRouteStubResult {
  code: string;
  map: unknown;
  routePath: string | null;
}

export function rootRelative(root: string, absolutePath: string): string {
  return `/${relative(root, absolutePath).split(sep).join("/")}`;
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

  return {
    clientRefs,
    code: result?.code ?? code,
    marksServerRoute,
    map: result?.map,
    serverRouteId,
  };
}

export async function transformServerRouteClientStub(
  code: string,
  id: string,
): Promise<ClientRouteStubResult> {
  let routePath: string | null = null;

  await transformTypeScript(code, id, {
    plugins: [routePathBabelPlugin((path) => (routePath = path))],
    sourceMaps: false,
  });

  if (routePath === null) {
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

  const stubCode =
    `import { createFileRoute } from "@bgub/fig-start";\n` +
    `import { markServerRoute as __figMarkServerRoute } from "@bgub/fig-start/internal";\n` +
    `export const Route = __figMarkServerRoute(createFileRoute(${JSON.stringify(
      routePath,
    )})());\n`;
  return {
    code: stubCode,
    map: generatedSourceMap(id, stubCode),
    routePath,
  };
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
                  `import { clientReference as __figClientRef } from "@bgub/fig";`,
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
            if (t.isImportDefaultSpecifier(spec)) {
              exportName = "default";
            } else if (t.isImportSpecifier(spec)) {
              exportName = t.isIdentifier(spec.imported)
                ? spec.imported.name
                : spec.imported.value;
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
                `const ${spec.local.name} = __figClientRef({ id: ${JSON.stringify(
                  id,
                )}, load: () => Promise.resolve({}) });`,
              ),
            );
          }

          if (declarations.length === 0) return;
          needsClientReferenceImport = true;
          path.replaceWithMultiple(declarations as never[]);
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

function routePathBabelPlugin(
  setRoutePath: (path: string) => void,
): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;

    return {
      name: "fig-start-server-route-stub",
      visitor: {
        VariableDeclarator(path) {
          const routePath = routePathFromDeclarator(path.node, t);
          if (routePath !== null) setRoutePath(routePath);
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
