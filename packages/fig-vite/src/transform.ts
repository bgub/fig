import babel, { type NodePath, type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

export interface TransformResult {
  code: string;
  map: unknown;
}

interface FunctionRecord {
  fnPath: NodePath;
  isComponent: boolean;
  isCustomHook: boolean;
  name: string;
}

interface SignatureResult {
  forceReset: boolean;
  signature: string;
}

// Babel visitor: find top-level component declarations (PascalCase functions),
// then inject calls to the Fig refresh runtime + a self-accepting HMR boundary.
// Emits register/setSignature directly (no react-refresh global protocol).
function figRefreshBabelPlugin(api: typeof babel): PluginObj {
  const t = api.types;
  const template = api.template;

  return {
    name: "fig-refresh",
    visitor: {
      Program: {
        exit(path) {
          const moduleId = (this as { opts?: { moduleId?: string } }).opts
            ?.moduleId;
          if (moduleId === undefined) return;

          const functions = new Map<string, FunctionRecord>();

          for (const statement of path.get("body")) {
            const exported =
              statement.isExportNamedDeclaration() ||
              statement.isExportDefaultDeclaration();
            const declaration = exported
              ? statement.get("declaration")
              : statement;
            if (!Array.isArray(declaration)) {
              collectFunction(declaration, functions);
            }
          }

          const components = [...functions.values()].filter(
            (record) => record.isComponent,
          );
          if (components.length === 0) return;

          const canSelfAccept = exportsOnlyComponents(path, functions);
          for (const component of components) {
            const result = signatureFor(component, [component.name]);
            (component as FunctionRecord & SignatureResult).signature =
              result.signature;
            (component as FunctionRecord & SignatureResult).forceReset =
              result.forceReset;
          }

          path.node.body.unshift(
            template.statement.ast(
              canSelfAccept
                ? `import { register as __figReg, setSignature as __figSig, enqueueRefresh as __figRefresh } from "virtual:fig-refresh";`
                : `import { register as __figReg, setSignature as __figSig } from "virtual:fig-refresh";`,
            ),
          );

          const tail = [];
          for (const component of components) {
            const signature =
              (component as FunctionRecord & Partial<SignatureResult>)
                .signature ?? "";
            const forceReset =
              (component as FunctionRecord & Partial<SignatureResult>)
                .forceReset === true;
            tail.push(
              template.statement.ast(
                `__figReg(${component.name}, ${JSON.stringify(
                  `${moduleId}#${component.name}`,
                )});`,
              ),
            );
            tail.push(
              template.statement.ast(
                forceReset
                  ? `__figSig(${component.name}, ${JSON.stringify(
                      signature,
                    )}, true);`
                  : `__figSig(${component.name}, ${JSON.stringify(
                      signature,
                    )});`,
              ),
            );
          }
          if (canSelfAccept) {
            tail.push(
              template.statement.ast(
                `if (import.meta.hot) { import.meta.hot.accept(); __figRefresh(); }`,
              ),
            );
          }
          path.node.body.push(...(tail as never[]));

          function collectFunction(
            declaration: NodePath,
            into: Map<string, FunctionRecord>,
          ): void {
            if (declaration.isFunctionDeclaration()) {
              const id = declaration.node.id;
              if (id != null) {
                const isComponent = isComponentName(id.name);
                const isCustomHook = isCustomHookName(id.name);
                if (isComponent || isCustomHook) {
                  into.set(id.name, {
                    fnPath: declaration,
                    isComponent,
                    isCustomHook,
                    name: id.name,
                  });
                }
              }
              return;
            }

            if (declaration.isVariableDeclaration()) {
              for (const declarator of declaration.get("declarations")) {
                const id = declarator.node.id;
                const init = declarator.node.init;
                if (
                  t.isIdentifier(id) &&
                  init != null &&
                  (t.isArrowFunctionExpression(init) ||
                    t.isFunctionExpression(init))
                ) {
                  const isComponent = isComponentName(id.name);
                  const isCustomHook = isCustomHookName(id.name);
                  if (!isComponent && !isCustomHook) continue;
                  into.set(id.name, {
                    fnPath: declarator.get("init") as NodePath,
                    isComponent,
                    isCustomHook,
                    name: id.name,
                  });
                }
              }
            }
          }

          function signatureFor(
            record: FunctionRecord,
            stack: string[],
          ): SignatureResult {
            const hookNames: string[] = [];
            let forceReset = false;

            record.fnPath.traverse({
              CallExpression(call) {
                if (call.getFunctionParent()?.node !== record.fnPath.node) {
                  return;
                }

                const callee = call.node.callee;
                const hookName = hookCallName(callee);
                if (hookName === null) {
                  return;
                }

                hookNames.push(hookName);
                const hookRecord = functions.get(hookName);
                if (hookRecord?.isCustomHook !== true) {
                  if (!isBuiltinFigHookName(hookName)) forceReset = true;
                  return;
                }

                if (stack.includes(hookName)) {
                  forceReset = true;
                  return;
                }

                const nested = signatureFor(hookRecord, [...stack, hookName]);
                forceReset = forceReset || nested.forceReset;
                if (nested.signature !== "") {
                  hookNames.push(
                    ...nested.signature.split("\n").map((line) => `>${line}`),
                  );
                }
              },
            });

            return { forceReset, signature: hookNames.join("\n") };
          }

          function hookCallName(
            callee: babel.types.Expression | babel.types.V8IntrinsicIdentifier,
          ): string | null {
            if (t.isIdentifier(callee)) {
              return isCustomHookName(callee.name) ? callee.name : null;
            }
            if (
              t.isMemberExpression(callee) &&
              !callee.computed &&
              t.isIdentifier(callee.property) &&
              isCustomHookName(callee.property.name)
            ) {
              return callee.property.name;
            }
            return null;
          }

          function exportsOnlyComponents(
            program: NodePath<babel.types.Program>,
            records: Map<string, FunctionRecord>,
          ): boolean {
            for (const statement of program.get("body")) {
              if (statement.isExportNamedDeclaration()) {
                if (statement.node.exportKind === "type") continue;
                const declaration = statement.get("declaration");
                if (!Array.isArray(declaration) && declaration.node != null) {
                  if (!declarationExportsOnlyComponents(declaration, records)) {
                    return false;
                  }
                  continue;
                }

                if (statement.node.source != null) {
                  for (const specifier of statement.node.specifiers) {
                    if (
                      "exportKind" in specifier &&
                      specifier.exportKind === "type"
                    ) {
                      continue;
                    }
                    return false;
                  }
                  continue;
                }

                for (const specifier of statement.get("specifiers")) {
                  if (
                    specifier.isExportSpecifier() &&
                    specifier.node.exportKind === "type"
                  ) {
                    continue;
                  }
                  if (!specifier.isExportSpecifier()) return false;
                  const local = specifier.node.local;
                  if (!t.isIdentifier(local)) return false;
                  if (records.get(local.name)?.isComponent !== true) {
                    return false;
                  }
                }
                continue;
              }

              if (statement.isExportDefaultDeclaration()) {
                const declaration = statement.get("declaration");
                if (Array.isArray(declaration)) return false;
                if (declaration.isFunctionDeclaration()) {
                  const id = declaration.node.id;
                  if (id == null || !isComponentName(id.name)) return false;
                  continue;
                }
                if (
                  declaration.isIdentifier() &&
                  records.get(declaration.node.name)?.isComponent === true
                ) {
                  continue;
                }
                return false;
              }

              if (statement.isExportAllDeclaration()) return false;
            }

            return true;
          }

          function declarationExportsOnlyComponents(
            declaration: NodePath<babel.types.Declaration | null | undefined>,
            records: Map<string, FunctionRecord>,
          ): boolean {
            if (declaration.isFunctionDeclaration()) {
              const id = declaration.node.id;
              return id != null && records.get(id.name)?.isComponent === true;
            }

            if (!declaration.isVariableDeclaration()) return false;

            for (const declarator of declaration.node.declarations) {
              if (!t.isIdentifier(declarator.id)) return false;
              if (records.get(declarator.id.name)?.isComponent !== true) {
                return false;
              }
            }
            return true;
          }
        },
      },
    },
  };
}

function isComponentName(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

function isCustomHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function isBuiltinFigHookName(name: string): boolean {
  return (
    name === "useActionState" ||
    name === "useBeforeLayout" ||
    name === "useBeforePaint" ||
    name === "useCallback" ||
    name === "useExternalStore" ||
    name === "useId" ||
    name === "useLaggedValue" ||
    name === "useMemo" ||
    name === "useReactive" ||
    name === "useStableEvent" ||
    name === "useState" ||
    name === "useTransition"
  );
}

// Transform a single module. Returns null when it has no components (so the
// caller leaves it for the regular pipeline).
export async function transformModule(
  code: string,
  id: string,
): Promise<TransformResult | null> {
  const result = await babel.transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: id,
    sourceMaps: true,
    presets: [
      [
        presetTypescript,
        {
          allExtensions: true,
          isTSX: id.endsWith("x"),
          onlyRemoveTypeImports: true,
        },
      ],
    ],
    plugins: [[figRefreshBabelPlugin, { moduleId: id }]],
  });

  if (result?.code == null || !result.code.includes("virtual:fig-refresh")) {
    return null;
  }
  return { code: result.code, map: result.map };
}
