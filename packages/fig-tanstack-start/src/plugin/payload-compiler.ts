import * as babel from "@babel/core";
import type { NodePath, PluginObject } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";
import { payloadStylesheetsSymbolKey } from "../payload-assets.ts";
import { cleanModuleId } from "./module-ids.ts";

export const payloadRuntimeId = "virtual:fig-tanstack-start/payload-runtime";
export const resolvedPayloadRuntimeId = `\0${payloadRuntimeId}`;

export interface IsomorphicImport {
  importedName: string;
  localName: string;
  source: string;
}

export interface CompiledIsomorphicImport extends IsomorphicImport {
  referenceId: string;
}

export async function analyzeStylesheetImports(
  code: string,
  id: string,
): Promise<string[]> {
  const clean = cleanModuleId(id);
  if (!/\.[cm]?[jt]sx?$/.test(clean)) return [];
  const stylesheets: string[] = [];
  await babel.transformAsync(code, {
    ...babelOptions(clean),
    plugins: [
      (): PluginObject => ({
        name: "fig-tanstack-start-stylesheet-import-analysis",
        visitor: {
          ImportDeclaration(path) {
            const source = path.node.source.value;
            if (isStylesheetSpecifier(source)) stylesheets.push(source);
          },
        },
      }),
    ],
  });
  return stylesheets;
}

export async function analyzePayloadModule(
  code: string,
  id: string,
): Promise<IsomorphicImport[]> {
  const clean = cleanModuleId(id);
  if (!isPayloadModule(clean)) return [];

  const imports: IsomorphicImport[] = [];
  await babel.transformAsync(code, {
    ...babelOptions(clean),
    plugins: [isomorphicImportAnalysisPlugin(imports)],
  });
  return imports;
}

export async function transformPayloadModule(
  code: string,
  id: string,
  isomorphicImports: readonly CompiledIsomorphicImport[] = [],
) {
  const clean = cleanModuleId(id);
  if (!isPayloadModule(clean)) return null;

  const result = await babel.transformAsync(code, {
    ...babelOptions(clean),
    sourceMaps: true,
    plugins: [payloadBabelPlugin(isomorphicImports)],
  });

  if (result?.code == null || !result.code.includes(payloadRuntimeId)) {
    return null;
  }
  return {
    code: result.code,
    map: result.map == null ? null : JSON.stringify(result.map),
  };
}

export function payloadRuntimeCode(): string {
  return `import { clientReference } from "@bgub/fig";
const stylesheetKey = Symbol.for(${JSON.stringify(payloadStylesheetsSymbolKey)});
export function createIsomorphicReference(id) {
  return clientReference({ id });
}
export function registerPayloadStylesheets(components, hrefs) {
  for (const component of components) {
    if (typeof component === "function") {
      Object.defineProperty(component, stylesheetKey, { configurable: true, value: hrefs });
    }
  }
}`;
}

function babelOptions(
  filename: string,
): NonNullable<Parameters<typeof babel.transformAsync>[1]> {
  return {
    babelrc: false,
    configFile: false,
    filename,
    presets: [
      [
        presetTypescript,
        { ignoreExtensions: true, onlyRemoveTypeImports: true },
      ],
    ],
    parserOpts: { plugins: filename.endsWith("x") ? ["jsx"] : [] },
  };
}

function isomorphicImportAnalysisPlugin(
  imports: IsomorphicImport[],
): () => PluginObject {
  return () => ({
    name: "fig-tanstack-start-isomorphic-import-analysis",
    visitor: {
      Program(path) {
        const componentBindings = new Set<string>();
        path.traverse({
          JSXOpeningElement(elementPath) {
            const name =
              elementPath.node.name.type === "JSXNamespacedName"
                ? undefined
                : rootJsxIdentifier(elementPath.node.name);
            if (name !== undefined) componentBindings.add(name);
          },
          CallExpression(callPath) {
            if (
              callPath.node.callee.type !== "Identifier" ||
              callPath.node.callee.name !== "createElement"
            ) {
              return;
            }
            const [type] = callPath.node.arguments;
            if (type?.type === "Identifier" && isComponentName(type.name)) {
              componentBindings.add(type.name);
            }
          },
        });

        for (const statement of path.get("body")) {
          if (!statement.isImportDeclaration()) continue;
          if (statement.node.importKind === "type") continue;
          const source = statement.node.source.value;
          if (isStylesheetSpecifier(source) || source === "@bgub/fig") {
            continue;
          }

          for (const specifier of statement.node.specifiers) {
            if (
              ("importKind" in specifier && specifier.importKind === "type") ||
              !componentBindings.has(specifier.local.name)
            ) {
              continue;
            }
            const importedName =
              specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : specifier.type === "ImportSpecifier"
                  ? specifier.imported.type === "Identifier"
                    ? specifier.imported.name
                    : specifier.imported.value
                  : undefined;
            if (importedName === undefined) continue;
            imports.push({
              importedName,
              localName: specifier.local.name,
              source,
            });
          }
        }
      },
    },
  });
}

function payloadBabelPlugin(
  isomorphicImports: readonly CompiledIsomorphicImport[],
): (api: typeof babel) => PluginObject {
  return (api: typeof babel) => {
    const t = api.types;

    return {
      name: "fig-tanstack-start-payload",
      visitor: {
        Program: {
          exit(path: NodePath<babel.types.Program>) {
            const components = collectComponentNames(path, t);
            const hrefs = rewriteStylesheetImports(path, t);
            const references = rewriteIsomorphicImports(
              path,
              t,
              isomorphicImports,
            );
            if (hrefs.length === 0 && references.length === 0) return;

            const runtimeSpecifiers: babel.types.ImportSpecifier[] = [];
            let createReference: babel.types.Identifier | undefined;
            if (references.length > 0) {
              createReference = path.scope.generateUidIdentifier(
                "createIsomorphicReference",
              );
              runtimeSpecifiers.push(
                t.importSpecifier(
                  createReference,
                  t.identifier("createIsomorphicReference"),
                ),
              );
            }
            let registerStylesheets: babel.types.Identifier | undefined;
            if (hrefs.length > 0 && components.length > 0) {
              registerStylesheets = path.scope.generateUidIdentifier(
                "registerPayloadStylesheets",
              );
              runtimeSpecifiers.push(
                t.importSpecifier(
                  registerStylesheets,
                  t.identifier("registerPayloadStylesheets"),
                ),
              );
            }
            if (runtimeSpecifiers.length === 0) return;

            path.node.body.unshift(
              t.importDeclaration(
                runtimeSpecifiers,
                t.stringLiteral(payloadRuntimeId),
              ),
            );
            if (createReference !== undefined) {
              const lastImport = path.node.body.findLastIndex((statement) =>
                t.isImportDeclaration(statement),
              );
              path.node.body.splice(
                lastImport + 1,
                0,
                ...references.map(({ localName, referenceId }) =>
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      t.identifier(localName),
                      t.callExpression(createReference, [
                        t.stringLiteral(referenceId),
                      ]),
                    ),
                  ]),
                ),
              );
            }
            if (registerStylesheets !== undefined) {
              path.node.body.push(
                t.expressionStatement(
                  t.callExpression(registerStylesheets, [
                    t.arrayExpression(
                      components.map((name) => t.identifier(name)),
                    ),
                    t.arrayExpression(hrefs),
                  ]),
                ),
              );
            }
          },
        },
      },
    };
  };
}

function rewriteStylesheetImports(
  path: NodePath<babel.types.Program>,
  t: typeof babel.types,
): babel.types.Identifier[] {
  const hrefs: babel.types.Identifier[] = [];
  for (const statement of path.get("body")) {
    if (!statement.isImportDeclaration()) continue;
    const source = statement.node.source.value;
    if (!isStylesheetSpecifier(source)) continue;

    const existingUrl = hasUrlQuery(source);
    const defaultSpecifier = statement.node.specifiers.find(
      (specifier): specifier is babel.types.ImportDefaultSpecifier =>
        t.isImportDefaultSpecifier(specifier),
    );
    if (existingUrl && defaultSpecifier !== undefined) {
      hrefs.push(defaultSpecifier.local);
      continue;
    }

    const local = path.scope.generateUidIdentifier("figPayloadStylesheet");
    if (statement.node.specifiers.length === 0) {
      statement.node.source = t.stringLiteral(withUrlQuery(source));
      statement.node.specifiers.push(t.importDefaultSpecifier(local));
    } else {
      statement.insertAfter(
        t.importDeclaration(
          [t.importDefaultSpecifier(local)],
          t.stringLiteral(withUrlQuery(source)),
        ),
      );
    }
    hrefs.push(local);
  }
  return hrefs;
}

function rewriteIsomorphicImports(
  path: NodePath<babel.types.Program>,
  t: typeof babel.types,
  references: readonly CompiledIsomorphicImport[],
): CompiledIsomorphicImport[] {
  if (references.length === 0) return [];
  const byLocalName = new Map(
    references.map((reference) => [reference.localName, reference]),
  );

  for (const statement of path.get("body")) {
    if (!statement.isImportDeclaration()) continue;
    const before = statement.node.specifiers.length;
    statement.node.specifiers = statement.node.specifiers.filter(
      (specifier) => !byLocalName.has(specifier.local.name),
    );
    if (before > 0 && statement.node.specifiers.length === 0) {
      statement.remove();
    }
  }
  return [...references];
}

function collectComponentNames(
  path: NodePath<babel.types.Program>,
  t: typeof babel.types,
): string[] {
  const names = new Set<string>();
  for (const statement of path.get("body")) {
    const declaration =
      statement.isExportNamedDeclaration() ||
      statement.isExportDefaultDeclaration()
        ? statement.get("declaration")
        : statement;
    if (Array.isArray(declaration)) continue;

    if (declaration.isFunctionDeclaration()) {
      const name = declaration.node.id?.name;
      if (name !== undefined && isComponentName(name)) names.add(name);
      continue;
    }
    if (!declaration.isVariableDeclaration()) continue;

    for (const declarator of declaration.node.declarations) {
      if (
        t.isIdentifier(declarator.id) &&
        isComponentName(declarator.id.name) &&
        (t.isArrowFunctionExpression(declarator.init) ||
          t.isFunctionExpression(declarator.init))
      ) {
        names.add(declarator.id.name);
      }
    }
  }
  return [...names];
}

function rootJsxIdentifier(
  name: babel.types.JSXIdentifier | babel.types.JSXMemberExpression,
): string | undefined {
  let current: typeof name = name;
  while (current.type === "JSXMemberExpression") current = current.object;
  return current.type === "JSXIdentifier" && isComponentName(current.name)
    ? current.name
    : undefined;
}

function isPayloadModule(id: string): boolean {
  return id.endsWith(".server.ts") || id.endsWith(".server.tsx");
}

function isComponentName(name: string): boolean {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 65 && first <= 90;
}

export function isStylesheetSpecifier(source: string): boolean {
  const path = cleanModuleId(source);
  return /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss)$/.test(path);
}

function hasUrlQuery(source: string): boolean {
  return /[?&]url(?:[=&]|$)/.test(source);
}

function withUrlQuery(source: string): string {
  if (hasUrlQuery(source)) return source;
  return `${source}${source.includes("?") ? "&" : "?"}url`;
}
