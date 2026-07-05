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
  serverDataResources: ServerDataResourceRef[];
  serverRouteId: string | null;
}

export interface ClientRouteStubResult {
  code: string;
  map: unknown;
  remoteResources: ClientRemoteDataResource[];
  routePath: string | null;
}

export interface ServerDataResourceRef {
  exportName: string;
  id: string;
  specifier: string;
}

export interface ClientRemoteDataResource {
  debugArgsCode?: string;
  exportName: string;
  id: string;
  importCodes: string[];
  keyCode: string;
  nameCode?: string;
}

interface ServerDataResourceDeclaration extends ServerDataResourceRef {
  options: babel.NodePath<babel.types.ObjectExpression>;
  remote: boolean;
}

const SERVER_DATA_RESOURCE_MODULE = "@bgub/fig-data/server";

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
  const serverDataResources: ServerDataResourceRef[] = [];
  let serverRouteId: string | null = null;

  const result = await transformTypeScript(code, id, {
    plugins: [
      serverComponentBabelPlugin({
        clientRefs,
        filename: id,
        importerDir,
        markServerRoute: () => {
          marksServerRoute = true;
        },
        serverDataResources,
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
  const remoteResources: ClientRemoteDataResource[] = [];

  await transformTypeScript(code, id, {
    plugins: [
      clientStubDiscoveryBabelPlugin({
        filename: id,
        remoteResources,
        root,
        setRoutePath: (path) => (routePath = path),
      }),
    ],
    sourceMaps: false,
  });

  if (routePath === null && remoteResources.length === 0) {
    const stubCode =
      `throw new Error(${JSON.stringify(
        `Cannot import server module "${id}" in a browser bundle.`,
      )});\n` + `export {};`;
    return {
      code: stubCode,
      map: generatedSourceMap(id, stubCode),
      remoteResources,
      routePath,
    };
  }

  const stubCode = clientStubCode(routePath, remoteResources);
  return {
    code: stubCode,
    map: generatedSourceMap(id, stubCode),
    remoteResources,
    routePath,
  };
}

function clientStubCode(
  routePath: string | null,
  remoteResources: readonly ClientRemoteDataResource[],
): string {
  const imports: string[] = [];
  const exports: string[] = [];

  if (routePath !== null) {
    imports.push(`import { createFileRoute } from "@bgub/fig-start";`);
    imports.push(
      `import { markServerRoute as __figMarkServerRoute } from "@bgub/fig-start/internal";`,
    );
    exports.push(
      `export const Route = __figMarkServerRoute(createFileRoute(${JSON.stringify(
        routePath,
      )})());`,
    );
  }

  if (remoteResources.length > 0) {
    const dependencyImports = new Set<string>();
    for (const resource of remoteResources) {
      for (const code of resource.importCodes) dependencyImports.add(code);
    }
    imports.push(...dependencyImports);
    imports.push(
      `import { dataResource as __figDataResource } from "@bgub/fig-data";`,
    );
    for (const resource of remoteResources) {
      exports.push(
        `export const ${resource.exportName} = __figDataResource.remote({ ${remoteResourceOptionFields(
          resource,
        ).join(", ")} });`,
      );
    }
  }

  return `${imports.join("\n")}\n${exports.join("\n")}\n`;
}

function remoteResourceOptionFields(
  resource: ClientRemoteDataResource,
): string[] {
  const fields = [
    `id: ${JSON.stringify(resource.id)}`,
    `key: ${resource.keyCode}`,
  ];
  if (resource.debugArgsCode !== undefined) {
    fields.push(`debugArgs: ${resource.debugArgsCode}`);
  }
  if (resource.nameCode !== undefined) {
    fields.push(`name: ${resource.nameCode}`);
  }
  return fields;
}

export async function assertNoServerDataResourceImport(
  code: string,
  id: string,
): Promise<void> {
  await transformTypeScript(code, id, {
    plugins: [serverDataResourceImportGuardBabelPlugin(id)],
    sourceMaps: false,
  });
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

function serverDataResourceImportGuardBabelPlugin(
  id: string,
): (api: typeof babel) => PluginObj {
  return (api) => {
    const error =
      `serverDataResource may only be imported from .server.ts or ` +
      `.server.tsx files. Move "${id}" to a .server.ts(x) file.`;

    return {
      name: "fig-start-server-data-resource-import-guard",
      visitor: {
        ImportDeclaration(path) {
          if (path.node.source.value !== SERVER_DATA_RESOURCE_MODULE) return;
          if (path.node.importKind === "type") return;
          if (
            path.node.specifiers.length > 0 &&
            path.node.specifiers.every((specifier) => {
              return (
                "importKind" in specifier && specifier.importKind === "type"
              );
            })
          ) {
            return;
          }
          throw path.buildCodeFrameError(error);
        },
        CallExpression(path) {
          if (!api.types.isImport(path.node.callee)) return;
          const [source] = path.node.arguments;
          if (
            api.types.isStringLiteral(source, {
              value: SERVER_DATA_RESOURCE_MODULE,
            })
          ) {
            throw path.buildCodeFrameError(error);
          }
        },
      },
    };
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
  filename: string;
  importerDir: string;
  markServerRoute: () => void;
  root: string;
  serverDataResources: ServerDataResourceRef[];
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
        VariableDeclarator(path) {
          const resource = serverDataResourceFromDeclarator(
            path,
            t,
            state.root,
            state.filename,
          );
          if (resource !== null) state.serverDataResources.push(resource);
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
  filename: string;
  remoteResources: ClientRemoteDataResource[];
  root: string;
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

          const resource = clientRemoteResourceFromDeclarator(
            path,
            t,
            state.root,
            state.filename,
          );
          if (resource !== null) state.remoteResources.push(resource);
        },
      },
    };
  };
}

function serverDataResourceFromDeclarator(
  path: babel.NodePath<babel.types.VariableDeclarator>,
  t: typeof babel.types,
  root: string,
  filename: string,
): ServerDataResourceRef | null {
  const declaration = serverDataResourceDeclaration(path, t, root, filename);
  if (declaration === null) return null;
  if (!declaration.remote) return null;
  return {
    exportName: declaration.exportName,
    id: declaration.id,
    specifier: declaration.specifier,
  };
}

function clientRemoteResourceFromDeclarator(
  path: babel.NodePath<babel.types.VariableDeclarator>,
  t: typeof babel.types,
  root: string,
  filename: string,
): ClientRemoteDataResource | null {
  const declaration = serverDataResourceDeclaration(path, t, root, filename);
  if (declaration === null) return null;
  if (!declaration.remote) return null;
  const { exportName, id, options } = declaration;

  const key = propertyValue(options, "key");
  if (key === null) {
    throw path.buildCodeFrameError(
      `Server data resource "${exportName}" must declare a key function.`,
    );
  }

  return {
    debugArgsCode: propertyValue(options, "debugArgs")?.getSource(),
    exportName,
    id,
    importCodes: dependencyImportsForRemoteResource(path, [
      key,
      propertyValue(options, "debugArgs"),
      propertyValue(options, "name"),
    ]),
    keyCode: key.getSource(),
    nameCode: propertyValue(options, "name")?.getSource(),
  };
}

function remoteServerDataResourceOption(
  path: babel.NodePath,
  options: babel.NodePath<babel.types.ObjectExpression>,
  exportName: string,
): boolean {
  const remote = propertyValue(options, "remote");
  if (remote === null) return false;
  if (remote.isBooleanLiteral({ value: true })) return true;

  throw path.buildCodeFrameError(
    `Server data resource "${exportName}" must use ` +
      `remote: true to expose a browser refresh endpoint. Omit remote for ` +
      `server-only resources.`,
  );
}

function dependencyImportsForRemoteResource(
  owner: babel.NodePath,
  expressions: Array<babel.NodePath<babel.types.Expression> | null>,
): string[] {
  const imports = new Set<string>();

  for (const expression of expressions) {
    if (expression === null) continue;
    for (const name of referencedIdentifierNames(expression)) {
      const binding = expression.scope.getBinding(name);
      if (binding === undefined) continue;
      if (bindingBelongsToExpression(binding.path, expression)) continue;

      const code = importCodeForBinding(binding.path, owner);
      if (code === null) {
        throw owner.buildCodeFrameError(
          `Server data resource browser stubs can only reference inline values ` +
            `or value imports from non-server modules. "${name}" is local to ` +
            `the server module, so it cannot be copied into the browser stub.`,
        );
      }
      imports.add(code);
    }
  }

  return [...imports];
}

function referencedIdentifierNames(
  expression: babel.NodePath<babel.types.Expression>,
): Set<string> {
  const names = new Set<string>();
  if (expression.isIdentifier()) names.add(expression.node.name);

  expression.traverse({
    ReferencedIdentifier(path) {
      names.add(path.node.name);
    },
  });

  return names;
}

function bindingBelongsToExpression(
  bindingPath: babel.NodePath,
  expression: babel.NodePath<babel.types.Expression>,
): boolean {
  let current: babel.NodePath | null = bindingPath;
  while (current !== null) {
    if (current === expression) return true;
    current = current.parentPath;
  }
  return false;
}

function importCodeForBinding(
  bindingPath: babel.NodePath,
  owner: babel.NodePath,
): string | null {
  if (
    !bindingPath.isImportSpecifier() &&
    !bindingPath.isImportDefaultSpecifier() &&
    !bindingPath.isImportNamespaceSpecifier()
  ) {
    return null;
  }
  if (!bindingPath.parentPath.isImportDeclaration()) return null;

  const source = bindingPath.parentPath.node.source.value;
  if (isServerModuleSource(source) || source === SERVER_DATA_RESOURCE_MODULE) {
    throw owner.buildCodeFrameError(
      `Server data resource browser stubs cannot import "${source}". ` +
        `Move the key/debug/name helper to a shared module that is safe for ` +
        `browser bundles.`,
    );
  }

  if (bindingPath.parentPath.node.importKind === "type") return null;

  if (bindingPath.isImportDefaultSpecifier()) {
    return `import ${bindingPath.node.local.name} from ${JSON.stringify(
      source,
    )};`;
  }
  if (bindingPath.isImportNamespaceSpecifier()) {
    return `import * as ${bindingPath.node.local.name} from ${JSON.stringify(
      source,
    )};`;
  }

  const imported = bindingPath.node.imported;
  const importedCode = babel.types.isIdentifier(imported)
    ? imported.name
    : JSON.stringify(imported.value);
  const local = bindingPath.node.local.name;
  const specifier =
    importedCode === local ? importedCode : `${importedCode} as ${local}`;
  return `import { ${specifier} } from ${JSON.stringify(source)};`;
}

function isServerModuleSource(source: string): boolean {
  return source.endsWith(".server.ts") || source.endsWith(".server.tsx");
}

function serverDataResourceDeclaration(
  path: babel.NodePath<babel.types.VariableDeclarator>,
  t: typeof babel.types,
  root: string,
  filename: string,
): ServerDataResourceDeclaration | null {
  const exportName = exportedConstName(path, t);
  if (exportName === null) return null;
  if (!t.isCallExpression(path.node.init)) return null;
  if (!t.isIdentifier(path.node.init.callee, { name: "serverDataResource" })) {
    return null;
  }

  const [options] = path.get("init").get("arguments");
  if (options === undefined || !options.isObjectExpression()) return null;

  const specifier = rootRelative(root, filename);
  return {
    exportName,
    id: clientRefId(specifier, exportName),
    options,
    remote: remoteServerDataResourceOption(path, options, exportName),
    specifier,
  };
}

function exportedConstName(
  path: babel.NodePath<babel.types.VariableDeclarator>,
  t: typeof babel.types,
): string | null {
  if (!t.isIdentifier(path.node.id)) return null;
  if (!path.parentPath.isVariableDeclaration({ kind: "const" })) return null;
  if (!path.parentPath.parentPath.isExportNamedDeclaration()) return null;
  return path.node.id.name;
}

function propertyValue(
  options: babel.NodePath<babel.types.ObjectExpression>,
  name: string,
): babel.NodePath<babel.types.Expression> | null {
  for (const property of options.get("properties")) {
    if (!property.isObjectProperty()) continue;
    const key = property.node.key;
    const isMatch =
      (babel.types.isIdentifier(key) && key.name === name) ||
      (babel.types.isStringLiteral(key) && key.value === name);
    if (!isMatch) continue;

    const value = property.get("value");
    return value.isExpression() ? value : null;
  }

  return null;
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
