import * as babel from "@babel/core";
import type { NodePath, PluginObject } from "@babel/core";
import { tanStackCompatibilityProfile } from "./compatibility-profile.ts";
import {
  babelOptions,
  isImportedBinding,
  isSourceModule,
  payloadPackageId,
  serverPackageId,
} from "./compiler-options.ts";
import { cleanModuleId } from "./module-ids.ts";

export async function transformPayloadResourceDefinitions(
  code: string,
  id: string,
) {
  const clean = cleanModuleId(id);
  if (!isSourceModule(clean) || !code.includes("payloadResource")) return null;

  const state = { transformed: false };
  const result = await babel.transformAsync(code, {
    ...babelOptions(clean),
    sourceMaps: true,
    plugins: [payloadResourceBabelPlugin(state)],
  });

  if (!state.transformed || result?.code == null) return null;
  return {
    code: result.code,
    map: result.map == null ? null : JSON.stringify(result.map),
  };
}

function payloadResourceBabelPlugin(state: {
  transformed: boolean;
}): (api: typeof babel) => PluginObject {
  return (api: typeof babel) => {
    const t = api.types;
    let createServerFn: babel.types.Identifier;
    let renderPayloadResponse: babel.types.Identifier;

    return {
      name: "fig-tanstack-start-payload-resource",
      visitor: {
        Program: {
          enter(path: NodePath<babel.types.Program>) {
            createServerFn = path.scope.generateUidIdentifier("createServerFn");
            renderPayloadResponse = path.scope.generateUidIdentifier(
              "renderPayloadResponse",
            );
          },
          exit(path: NodePath<babel.types.Program>) {
            if (!state.transformed) return;
            path.node.body.unshift(
              t.importDeclaration(
                [
                  t.importSpecifier(
                    renderPayloadResponse,
                    t.identifier("renderPayloadResponse"),
                  ),
                ],
                t.stringLiteral(serverPackageId),
              ),
            );
            path.node.body.unshift(
              t.importDeclaration(
                [
                  t.importSpecifier(
                    createServerFn,
                    t.identifier("createServerFn"),
                  ),
                ],
                t.stringLiteral(
                  tanStackCompatibilityProfile.packages.frameworkStart,
                ),
              ),
            );
          },
        },
        CallExpression(path: NodePath<babel.types.CallExpression>) {
          if (
            path.node.callee.type !== "Identifier" ||
            !isImportedBinding(
              path,
              path.node.callee.name,
              "payloadResource",
              payloadPackageId,
            )
          ) {
            return;
          }

          transformPayloadResourceCall(
            path,
            t,
            createServerFn,
            renderPayloadResponse,
          );
          state.transformed = true;
        },
      },
    };
  };
}

function transformPayloadResourceCall(
  path: NodePath<babel.types.CallExpression>,
  t: typeof babel.types,
  createServerFn: babel.types.Identifier,
  renderPayloadResponse: babel.types.Identifier,
): void {
  const [options] = path.node.arguments;
  if (options?.type !== "ObjectExpression") {
    throw path.buildCodeFrameError(
      "payloadResource options must be an inline object literal so Fig can compile its server render function.",
    );
  }

  const declarator = path.parentPath;
  if (
    !declarator.isVariableDeclarator() ||
    declarator.node.init !== path.node
  ) {
    throw path.buildCodeFrameError(
      "payloadResource must initialize a top-level variable.",
    );
  }
  const declaration = declarator.parentPath;
  if (!declaration.isVariableDeclaration()) {
    throw path.buildCodeFrameError(
      "payloadResource must initialize a top-level variable.",
    );
  }
  const statement = declaration.parentPath.isExportNamedDeclaration()
    ? declaration.parentPath
    : declaration;
  if (!statement.parentPath.isProgram()) {
    throw path.buildCodeFrameError(
      "payloadResource must initialize a top-level variable.",
    );
  }

  const properties = new Map<
    string,
    babel.types.ObjectProperty | babel.types.ObjectMethod
  >();
  for (const property of options.properties) {
    if (property.type === "SpreadElement") {
      throw path.buildCodeFrameError(
        "payloadResource options cannot contain spreads.",
      );
    }
    const name = propertyName(property);
    if (name === undefined) continue;
    if (properties.has(name)) {
      throw path.buildCodeFrameError(
        `payloadResource option ${JSON.stringify(name)} may only be declared once.`,
      );
    }
    properties.set(name, property);
  }

  if (properties.has("request")) {
    throw path.buildCodeFrameError(
      "payloadResource no longer accepts request. Declare an inline render callback; Fig compiles the server request.",
    );
  }
  const renderProperty = properties.get("render");
  if (renderProperty === undefined) {
    throw path.buildCodeFrameError(
      "payloadResource requires an inline render callback.",
    );
  }
  const render = inlineFunctionValue(renderProperty, path, t);

  const resourceName =
    declarator.node.id.type === "Identifier"
      ? `${declarator.node.id.name}Request`
      : "payloadRequest";
  const request = statement.scope.generateUidIdentifier(resourceName);
  const data = statement.scope.generateUidIdentifier("data");
  const input = statement.scope.generateUidIdentifier("input");
  const signal = statement.scope.generateUidIdentifier("signal");

  const serverFn = t.callExpression(
    t.memberExpression(
      t.callExpression(createServerFn, []),
      t.identifier("handler"),
    ),
    [
      t.arrowFunctionExpression(
        [
          t.objectPattern([
            t.objectProperty(t.identifier("data"), data, false, false),
          ]),
        ],
        t.callExpression(renderPayloadResponse, [
          t.awaitExpression(t.callExpression(render, [data])),
        ]),
        true,
      ),
    ],
  );

  statement.insertBefore(
    t.variableDeclaration("const", [t.variableDeclarator(request, serverFn)]),
  );

  options.properties = options.properties.filter(
    (property) => property !== renderProperty,
  );
  options.properties.push(
    t.objectProperty(
      t.identifier("request"),
      t.arrowFunctionExpression(
        [
          input,
          t.objectPattern([
            t.objectProperty(t.identifier("signal"), signal, false, false),
          ]),
        ],
        t.callExpression(request, [
          t.objectExpression([
            t.objectProperty(t.identifier("data"), input, false, false),
            t.objectProperty(t.identifier("signal"), signal, false, false),
          ]),
        ]),
      ),
    ),
  );
}

function inlineFunctionValue(
  property: babel.types.ObjectProperty | babel.types.ObjectMethod,
  path: NodePath,
  t: typeof babel.types,
): babel.types.Expression {
  if (property.type === "ObjectMethod") {
    if (property.kind !== "method" || property.generator) {
      throw path.buildCodeFrameError(
        "payloadResource render must be a regular function.",
      );
    }
    const expression = t.functionExpression(
      null,
      property.params,
      property.body,
      false,
      property.async,
    );
    expression.returnType = property.returnType;
    expression.typeParameters = property.typeParameters;
    return expression;
  }
  const value = property.value;
  if (
    value.type === "ArrowFunctionExpression" ||
    (value.type === "FunctionExpression" && !value.generator)
  ) {
    return value;
  }
  throw path.buildCodeFrameError(
    "payloadResource render must be an inline function.",
  );
}

function propertyName(
  property: babel.types.ObjectProperty | babel.types.ObjectMethod,
): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "StringLiteral") return property.key.value;
  return undefined;
}
