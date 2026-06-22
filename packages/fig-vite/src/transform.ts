import babel, { type NodePath, type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

export interface TransformResult {
  code: string;
  map: unknown;
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

          const components: Array<{ name: string; fnPath: NodePath }> = [];

          for (const statement of path.get("body")) {
            const exported =
              statement.isExportNamedDeclaration() ||
              statement.isExportDefaultDeclaration();
            const declaration = exported
              ? statement.get("declaration")
              : statement;
            if (!Array.isArray(declaration)) {
              collectComponent(declaration, components);
            }
          }

          if (components.length === 0) return;

          for (const component of components) {
            const hookNames: string[] = [];
            component.fnPath.traverse({
              CallExpression(call) {
                const callee = call.node.callee;
                if (t.isIdentifier(callee) && /^use[A-Z]/.test(callee.name)) {
                  hookNames.push(callee.name);
                }
              },
            });
            (component as { signature?: string }).signature =
              hookNames.join("\n");
          }

          path.node.body.unshift(
            template.statement.ast(
              `import { register as __figReg, setSignature as __figSig, enqueueRefresh as __figRefresh } from "virtual:fig-refresh";`,
            ),
          );

          const tail = [];
          for (const component of components) {
            const signature =
              (component as { signature?: string }).signature ?? "";
            tail.push(
              template.statement.ast(
                `__figReg(${component.name}, ${JSON.stringify(
                  `${moduleId}#${component.name}`,
                )});`,
              ),
            );
            tail.push(
              template.statement.ast(
                `__figSig(${component.name}, ${JSON.stringify(signature)});`,
              ),
            );
          }
          tail.push(
            template.statement.ast(
              `if (import.meta.hot) { import.meta.hot.accept(); __figRefresh(); }`,
            ),
          );
          path.node.body.push(...(tail as never[]));

          function collectComponent(
            declaration: NodePath,
            into: Array<{ name: string; fnPath: NodePath }>,
          ): void {
            if (declaration.isFunctionDeclaration()) {
              const id = declaration.node.id;
              if (id != null && isComponentName(id.name)) {
                into.push({ name: id.name, fnPath: declaration });
              }
              return;
            }

            if (declaration.isVariableDeclaration()) {
              for (const declarator of declaration.get("declarations")) {
                const id = declarator.node.id;
                const init = declarator.node.init;
                if (
                  t.isIdentifier(id) &&
                  isComponentName(id.name) &&
                  init != null &&
                  (t.isArrowFunctionExpression(init) ||
                    t.isFunctionExpression(init))
                ) {
                  into.push({
                    name: id.name,
                    fnPath: declarator.get("init") as NodePath,
                  });
                }
              }
            }
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
