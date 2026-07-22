import type { NodePath, PluginObject } from "@babel/core";
import type * as babel from "@babel/core";
import { isComponentName } from "./compiler-options.ts";
import { cleanModuleId, hasModuleQuery } from "./module-ids.ts";

export function stylesheetImportAnalysisPlugin(
  stylesheets: string[],
): () => PluginObject {
  return () => ({
    name: "fig-tanstack-start-stylesheet-import-analysis",
    visitor: {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        if (isStylesheetSpecifier(source)) stylesheets.push(source);
      },
    },
  });
}

export function rewriteStylesheetImports(
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

export function collectComponentNames(
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

export function isStylesheetSpecifier(source: string): boolean {
  const path = cleanModuleId(source);
  return /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss)$/.test(path);
}

function hasUrlQuery(source: string): boolean {
  return hasModuleQuery(source, "url");
}

// Vite's url plugin only matches the bare `?url` flag, so this cannot use
// withModuleQuery's `name=value` form.
function withUrlQuery(source: string): string {
  if (hasUrlQuery(source)) return source;
  return `${source}${source.includes("?") ? "&" : "?"}url`;
}
