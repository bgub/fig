import * as babel from "@babel/core";
import type { NodePath, PluginObject } from "@babel/core";
import { payloadStylesheetsSymbolKey } from "../payload-assets.ts";
import {
  babelOptions,
  isComponentName,
  isImportedBinding,
  isSourceModule,
  serverPackageId,
} from "./compiler-options.ts";
import {
  type CompiledIsomorphicImport,
  type IsomorphicImport,
  isomorphicBoundaryAnalysisPlugin,
  rewriteIsomorphicBoundaries,
} from "./isomorphic-compiler.ts";
import {
  cleanModuleId,
  hasModuleQuery,
  payloadModuleQuery,
  withModuleQuery,
} from "./module-ids.ts";
import {
  collectComponentNames,
  isStylesheetSpecifier,
  rewriteStylesheetImports,
  stylesheetImportAnalysisPlugin,
} from "./payload-stylesheet-compiler.ts";

export const payloadRuntimeId = "virtual:fig-tanstack-start/payload-runtime";
export const resolvedPayloadRuntimeId = `\0${payloadRuntimeId}`;

const figRuntimePackageIds: readonly string[] = [
  "@bgub/fig",
  "@bgub/fig-devtools",
  "@bgub/fig-dom",
  "@bgub/fig-reconciler",
  "@bgub/fig-refresh",
  "@bgub/fig-server",
  "@bgub/fig-tanstack-router",
  "@bgub/fig-tanstack-start",
  "@bgub/fig-vite",
];

export async function analyzeStylesheetImports(
  code: string,
  id: string,
): Promise<string[]> {
  const clean = cleanModuleId(id);
  if (!isSourceModule(clean)) return [];
  const stylesheets: string[] = [];
  await babel.transformAsync(code, {
    ...babelOptions(clean),
    plugins: [stylesheetImportAnalysisPlugin(stylesheets)],
  });
  return stylesheets;
}

export async function analyzeIsomorphicBoundaries(
  code: string,
  id: string,
): Promise<IsomorphicImport[]> {
  const clean = cleanModuleId(id);
  if (!isSourceModule(clean) || !code.includes("Isomorphic")) return [];

  const imports: IsomorphicImport[] = [];
  await babel.transformAsync(code, {
    ...babelOptions(clean),
    plugins: [isomorphicBoundaryAnalysisPlugin(imports)],
  });
  return imports;
}

// Cheap pre-parse gate shared with the Vite transform hook, so callers can
// skip boundary analysis for modules this transform cannot apply to.
export function mayBePayloadModule(code: string, id: string): boolean {
  return (
    isSourceModule(cleanModuleId(id)) &&
    (hasModuleQuery(id, payloadModuleQuery) ||
      code.includes("renderPayloadResponse"))
  );
}

export async function transformPayloadModule(
  code: string,
  id: string,
  isomorphicImports: readonly CompiledIsomorphicImport[] = [],
) {
  if (!mayBePayloadModule(code, id)) return null;

  const state = { changed: false };
  const result = await babel.transformAsync(code, {
    ...babelOptions(cleanModuleId(id)),
    sourceMaps: true,
    plugins: [
      payloadBabelPlugin(
        isomorphicImports,
        hasModuleQuery(id, payloadModuleQuery),
        state,
      ),
    ],
  });

  if (!state.changed || result?.code == null) return null;
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

function payloadBabelPlugin(
  isomorphicImports: readonly CompiledIsomorphicImport[],
  compiledPayloadModule: boolean,
  state: { changed: boolean },
): (api: typeof babel) => PluginObject {
  return (api: typeof babel) => {
    const t = api.types;

    return {
      name: "fig-tanstack-start-payload",
      visitor: {
        Program: {
          exit(path: NodePath<babel.types.Program>) {
            if (!compiledPayloadModule && !callsRenderPayloadResponse(path)) {
              return;
            }
            const components = collectComponentNames(path, t);
            const hrefs =
              components.length === 0 ? [] : rewriteStylesheetImports(path, t);
            const createReference = rewriteIsomorphicBoundaries(
              path,
              t,
              isomorphicImports,
            );

            if (rewritePayloadComponentImports(path) > 0) state.changed = true;

            const runtimeSpecifiers: babel.types.ImportSpecifier[] = [];
            if (createReference !== undefined) {
              runtimeSpecifiers.push(
                t.importSpecifier(
                  createReference,
                  t.identifier("createIsomorphicReference"),
                ),
              );
            }
            let registerStylesheets: babel.types.Identifier | undefined;
            if (hrefs.length > 0) {
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
            state.changed = true;

            path.node.body.unshift(
              t.importDeclaration(
                runtimeSpecifiers,
                t.stringLiteral(payloadRuntimeId),
              ),
            );
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

function callsRenderPayloadResponse(
  path: NodePath<babel.types.Program>,
): boolean {
  let found = false;
  path.traverse({
    CallExpression(callPath) {
      if (
        callPath.node.callee.type === "Identifier" &&
        isImportedBinding(
          callPath,
          callPath.node.callee.name,
          "renderPayloadResponse",
          serverPackageId,
        )
      ) {
        found = true;
        callPath.stop();
      }
    },
  });
  return found;
}

// Returns the number of import declarations marked with the payload query.
function rewritePayloadComponentImports(
  path: NodePath<babel.types.Program>,
): number {
  const componentBindings = new Set<string>();
  path.traverse({
    JSXOpeningElement(elementPath) {
      if (elementPath.node.name.type === "JSXNamespacedName") return;
      const name = rootJsxIdentifier(elementPath.node.name);
      if (name !== undefined) componentBindings.add(name);
    },
    CallExpression(callPath) {
      if (
        callPath.node.callee.type !== "Identifier" ||
        !isImportedBinding(
          callPath,
          callPath.node.callee.name,
          "createElement",
          "@bgub/fig",
        )
      ) {
        return;
      }
      const [type] = callPath.node.arguments;
      if (type?.type === "Identifier" && isComponentName(type.name)) {
        componentBindings.add(type.name);
      }
    },
  });

  let count = 0;
  for (const statement of path.get("body")) {
    if (!statement.isImportDeclaration()) continue;
    const source = statement.node.source.value;
    if (
      statement.node.importKind === "type" ||
      isStylesheetSpecifier(source) ||
      isFigRuntimeSpecifier(source) ||
      hasModuleQuery(source, payloadModuleQuery) ||
      !statement.node.specifiers.some(
        (specifier) =>
          !("importKind" in specifier && specifier.importKind === "type") &&
          componentBindings.has(specifier.local.name),
      )
    ) {
      continue;
    }
    statement.node.source.value = withModuleQuery(
      source,
      payloadModuleQuery,
      "1",
    );
    count += 1;
  }
  return count;
}

function isFigRuntimeSpecifier(source: string): boolean {
  return figRuntimePackageIds.some(
    (packageId) => source === packageId || source.startsWith(`${packageId}/`),
  );
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
