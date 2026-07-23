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

const compiledServerPayloadMarkerKey =
  "fig.tanstack-start.compiled-server-payload";

export async function transformServerPayloadDefinitions(
  code: string,
  id: string,
) {
  const clean = cleanModuleId(id);
  if (!isSourceModule(clean) || !code.includes("serverPayload")) return null;

  const state = { transformed: false };
  const result = await babel.transformAsync(code, {
    ...babelOptions(clean),
    sourceMaps: true,
    plugins: [serverPayloadBabelPlugin(state)],
  });

  if (!state.transformed || result?.code == null) return null;
  return {
    code: result.code,
    map: result.map == null ? null : JSON.stringify(result.map),
  };
}

function serverPayloadBabelPlugin(state: {
  transformed: boolean;
}): (api: typeof babel) => PluginObject {
  return (api: typeof babel) => {
    const t = api.types;
    let createElement: babel.types.Identifier;
    let createServerFn: babel.types.Identifier;
    let renderPayloadResponse: babel.types.Identifier;

    return {
      name: "fig-tanstack-start-server-payload",
      visitor: {
        Program: {
          enter(path: NodePath<babel.types.Program>) {
            createElement = path.scope.generateUidIdentifier("createElement");
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
                    createElement,
                    t.identifier("createElement"),
                  ),
                ],
                t.stringLiteral("@bgub/fig"),
              ),
            );
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
              "serverPayload",
              payloadPackageId,
            )
          ) {
            return;
          }

          transformServerPayloadCall(
            path,
            t,
            createElement,
            createServerFn,
            renderPayloadResponse,
          );
          state.transformed = true;
        },
      },
    };
  };
}

function transformServerPayloadCall(
  path: NodePath<babel.types.CallExpression>,
  t: typeof babel.types,
  createElement: babel.types.Identifier,
  createServerFn: babel.types.Identifier,
  renderPayloadResponse: babel.types.Identifier,
): void {
  const [render, ...extra] = path.node.arguments;
  if (
    render === undefined ||
    render.type === "SpreadElement" ||
    render.type === "ArgumentPlaceholder" ||
    extra.length > 0
  ) {
    throw path.buildCodeFrameError(
      "serverPayload requires exactly one server component or render callback.",
    );
  }
  if (!isRenderExpression(render)) {
    throw path.buildCodeFrameError(
      "serverPayload requires a component reference or inline render callback.",
    );
  }
  const statement = path.getStatementParent();
  if (
    path.getFunctionParent() !== null ||
    statement === null ||
    !statement.parentPath.isProgram()
  ) {
    throw path.buildCodeFrameError(
      "serverPayload must be declared in a top-level statement.",
    );
  }

  const declarator = path.findParent((candidate) =>
    candidate.isVariableDeclarator(),
  );
  const requestName =
    declarator?.isVariableDeclarator() &&
    declarator.node.id.type === "Identifier"
      ? `${declarator.node.id.name}Request`
      : "payloadRequest";
  const request = statement.scope.generateUidIdentifier(requestName);
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
          t.callExpression(createElement, [render, data]),
        ]),
      ),
    ],
  );

  statement.insertBefore(
    t.variableDeclaration("const", [t.variableDeclarator(request, serverFn)]),
  );
  const proxy = t.arrowFunctionExpression(
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
  );
  path.node.arguments = [
    t.callExpression(
      t.memberExpression(t.identifier("Object"), t.identifier("assign")),
      [
        proxy,
        t.objectExpression([
          t.objectProperty(
            t.callExpression(
              t.memberExpression(t.identifier("Symbol"), t.identifier("for")),
              [t.stringLiteral(compiledServerPayloadMarkerKey)],
            ),
            t.booleanLiteral(true),
            true,
          ),
        ]),
      ],
    ),
  ];
}

function isRenderExpression(
  value: babel.types.Expression,
): value is
  | babel.types.ArrowFunctionExpression
  | babel.types.FunctionExpression
  | babel.types.Identifier
  | babel.types.MemberExpression {
  return (
    value.type === "ArrowFunctionExpression" ||
    (value.type === "FunctionExpression" && !value.generator) ||
    value.type === "Identifier" ||
    value.type === "MemberExpression"
  );
}
