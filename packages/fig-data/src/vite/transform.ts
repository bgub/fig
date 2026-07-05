import { relative, sep } from "node:path";
import babel, { type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

const SERVER_DATA_RESOURCE_MODULE = "@bgub/fig-data/server";

export interface ServerDataResourceRef {
  exportName: string;
  id: string;
  specifier: string;
}

export interface ClientDataResourceStub {
  debugArgsCode?: string;
  exportName: string;
  id: string;
  importCodes: string[];
  keyCode: string;
  remote: boolean;
}

export interface ServerDataClientStubResult {
  code: string;
  map: unknown;
  stubs: ClientDataResourceStub[];
}

interface ServerDataResourceDeclaration extends ServerDataResourceRef {
  options: babel.NodePath<babel.types.ObjectExpression>;
  remote: boolean;
}

export function rootRelative(root: string, absolutePath: string): string {
  return `/${relative(root, absolutePath).split(sep).join("/")}`;
}

export function dataResourceId(specifier: string, exportName: string): string {
  return `${specifier}#${exportName}`;
}

export async function discoverServerDataResources(
  code: string,
  id: string,
  root: string,
): Promise<ServerDataResourceRef[]> {
  const serverDataResources: ServerDataResourceRef[] = [];

  await transformTypeScript(code, id, {
    plugins: [
      serverDataDiscoveryBabelPlugin({
        filename: id,
        root,
        serverDataResources,
      }),
    ],
    sourceMaps: false,
  });

  return serverDataResources;
}

export async function transformServerDataClientStub(
  code: string,
  id: string,
  root: string,
): Promise<ServerDataClientStubResult> {
  const stubs: ClientDataResourceStub[] = [];

  await transformTypeScript(code, id, {
    plugins: [
      clientStubDiscoveryBabelPlugin({
        filename: id,
        root,
        stubs,
      }),
    ],
    sourceMaps: false,
  });

  const stubCode =
    stubs.length === 0
      ? `throw new Error(${JSON.stringify(
          `Cannot import server module "${id}" in a browser bundle.`,
        )});\nexport {};`
      : clientStubCode(stubs);

  return {
    code: stubCode,
    map: generatedSourceMap(id, stubCode),
    stubs,
  };
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

function clientStubCode(stubs: readonly ClientDataResourceStub[]): string {
  const imports = new Set<string>();
  const exports: string[] = [];

  for (const stub of stubs) {
    for (const code of stub.importCodes) imports.add(code);
  }
  imports.add(
    `import { dataResource as __figDataResource } from "@bgub/fig-data";`,
  );

  for (const stub of stubs) {
    const factory = stub.remote
      ? "__figDataResource.remote"
      : "__figDataResource";
    exports.push(
      `export const ${stub.exportName} = ${factory}({ ${stubOptionFields(
        stub,
      ).join(", ")} });`,
    );
  }

  return `${[...imports].join("\n")}\n${exports.join("\n")}\n`;
}

function stubOptionFields(stub: ClientDataResourceStub): string[] {
  const fields = stub.remote ? [`id: ${JSON.stringify(stub.id)}`] : [];
  fields.push(`key: ${stub.keyCode}`);
  if (stub.debugArgsCode !== undefined) {
    fields.push(`debugArgs: ${stub.debugArgsCode}`);
  }
  return fields;
}

function serverDataDiscoveryBabelPlugin(state: {
  filename: string;
  root: string;
  serverDataResources: ServerDataResourceRef[];
}): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;

    return {
      name: "fig-data-server-resource-discovery",
      visitor: {
        VariableDeclarator(path) {
          const declaration = serverDataResourceDeclaration(
            path,
            t,
            state.root,
            state.filename,
          );
          if (declaration === null || !declaration.remote) return;
          state.serverDataResources.push({
            exportName: declaration.exportName,
            id: declaration.id,
            specifier: declaration.specifier,
          });
        },
      },
    };
  };
}

function clientStubDiscoveryBabelPlugin(state: {
  filename: string;
  root: string;
  stubs: ClientDataResourceStub[];
}): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;

    return {
      name: "fig-data-server-resource-client-stub",
      visitor: {
        VariableDeclarator(path) {
          const stub = clientDataResourceStubFromDeclarator(
            path,
            t,
            state.root,
            state.filename,
          );
          if (stub !== null) state.stubs.push(stub);
        },
      },
    };
  };
}

function clientDataResourceStubFromDeclarator(
  path: babel.NodePath<babel.types.VariableDeclarator>,
  t: typeof babel.types,
  root: string,
  filename: string,
): ClientDataResourceStub | null {
  const declaration = serverDataResourceDeclaration(path, t, root, filename);
  if (declaration === null) return null;
  const { exportName, id, options, remote } = declaration;

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
    importCodes: dependencyImportsForClientStub(path, [
      key,
      propertyValue(options, "debugArgs"),
    ]),
    keyCode: key.getSource(),
    remote,
  };
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
    id: dataResourceId(specifier, exportName),
    options,
    remote: remoteServerDataResourceOption(path, options, exportName),
    specifier,
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

function dependencyImportsForClientStub(
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
        `Move key/debug helpers to a shared module that is safe for browser ` +
        `bundles.`,
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

function serverDataResourceImportGuardBabelPlugin(
  id: string,
): (api: typeof babel) => PluginObj {
  return (api) => {
    const error =
      `serverDataResource may only be imported from .server.ts or ` +
      `.server.tsx files. Move "${id}" to a .server.ts(x) file.`;

    return {
      name: "fig-data-server-resource-import-guard",
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
    sources: [`${id}?fig-data-client-stub`],
    sourcesContent: [code],
    version: 3,
  };
}
