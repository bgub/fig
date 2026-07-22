import type { NodePath, PluginObject } from "@babel/core";
import type * as babel from "@babel/core";
import { isImportedBinding, payloadPackageId } from "./compiler-options.ts";

export interface IsomorphicImport {
  importedName: string;
  localName: string;
  source: string;
}

export interface CompiledIsomorphicImport extends IsomorphicImport {
  referenceId: string;
}

export function isomorphicBoundaryAnalysisPlugin(
  imports: IsomorphicImport[],
): () => PluginObject {
  return () => ({
    name: "fig-tanstack-start-isomorphic-boundary-analysis",
    visitor: {
      Program(path) {
        const seen = new Set<string>();
        path.traverse({
          JSXOpeningElement(elementPath) {
            if (
              elementPath.node.name.type !== "JSXIdentifier" ||
              !isIsomorphicBoundary(elementPath, elementPath.node.name.name)
            ) {
              return;
            }
            const component = isomorphicComponentAttribute(elementPath);
            const imported = importedComponent(
              elementPath,
              component.node.name,
            );
            const key = `${imported.source}\0${imported.importedName}\0${component.node.name}`;
            if (seen.has(key)) return;
            seen.add(key);
            imports.push({ ...imported, localName: component.node.name });
          },
        });
      },
    },
  });
}

// Returns the local identifier for the runtime's createIsomorphicReference
// when at least one boundary was rewritten, undefined otherwise.
export function rewriteIsomorphicBoundaries(
  path: NodePath<babel.types.Program>,
  t: typeof babel.types,
  references: readonly CompiledIsomorphicImport[],
): babel.types.Identifier | undefined {
  if (references.length === 0) return undefined;
  const byLocalName = new Map(
    references.map((reference) => [reference.localName, reference]),
  );
  const createReference = path.scope.generateUidIdentifier(
    "createIsomorphicReference",
  );
  let count = 0;

  path.traverse({
    JSXOpeningElement(elementPath) {
      if (
        elementPath.node.name.type !== "JSXIdentifier" ||
        !isIsomorphicBoundary(elementPath, elementPath.node.name.name)
      ) {
        return;
      }
      const component = isomorphicComponentAttribute(elementPath);
      const reference = byLocalName.get(component.node.name);
      if (reference === undefined) return;
      component.replaceWith(
        t.callExpression(t.cloneNode(createReference), [
          t.stringLiteral(reference.referenceId),
        ]),
      );
      count += 1;
    },
  });
  if (count === 0) return undefined;

  path.scope.crawl();
  for (const localName of byLocalName.keys()) {
    const binding = path.scope.getBinding(localName);
    if (
      binding?.referenced ||
      (!binding?.path.isImportSpecifier() &&
        !binding?.path.isImportDefaultSpecifier())
    ) {
      continue;
    }
    const declaration = binding.path.parentPath;
    binding.path.remove();
    if (
      declaration.isImportDeclaration() &&
      declaration.node.specifiers.length === 0
    ) {
      declaration.remove();
    }
  }
  return createReference;
}

function isIsomorphicBoundary(path: NodePath, localName: string): boolean {
  return isImportedBinding(path, localName, "Isomorphic", payloadPackageId);
}

function isomorphicComponentAttribute(
  path: NodePath<babel.types.JSXOpeningElement>,
): NodePath<babel.types.Identifier> {
  const attribute = path
    .get("attributes")
    .find(
      (candidate) =>
        candidate.isJSXAttribute() &&
        candidate.node.name.type === "JSXIdentifier" &&
        candidate.node.name.name === "component",
    );
  if (attribute === undefined || !attribute.isJSXAttribute()) {
    throw path.buildCodeFrameError(
      "Isomorphic requires a component prop containing a statically imported component.",
    );
  }
  const value = attribute.get("value");
  if (!value.isJSXExpressionContainer()) {
    throw attribute.buildCodeFrameError(
      "Isomorphic component must be a statically imported component identifier.",
    );
  }
  const expression = value.get("expression");
  if (Array.isArray(expression) || !expression.isIdentifier()) {
    throw value.buildCodeFrameError(
      "Isomorphic component must be a statically imported component identifier.",
    );
  }
  return expression;
}

function importedComponent(
  path: NodePath,
  localName: string,
): Omit<IsomorphicImport, "localName"> {
  const binding = path.scope.getBinding(localName);
  if (
    binding === undefined ||
    (!binding.path.isImportSpecifier() &&
      !binding.path.isImportDefaultSpecifier()) ||
    !binding.path.parentPath.isImportDeclaration()
  ) {
    throw path.buildCodeFrameError(
      "Isomorphic component must be a statically imported component identifier.",
    );
  }
  const importedName = binding.path.isImportDefaultSpecifier()
    ? "default"
    : binding.path.node.imported.type === "Identifier"
      ? binding.path.node.imported.name
      : binding.path.node.imported.value;
  return {
    importedName,
    source: binding.path.parentPath.node.source.value,
  };
}
