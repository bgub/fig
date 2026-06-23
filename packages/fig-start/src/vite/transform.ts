import { dirname, relative, resolve, sep } from "node:path";
import babel, { type PluginObj } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

export interface ClientRef {
  // Stable id ("<root-relative-path>#<Export>") shared by the server transform
  // and the client manifest (both go through this module, so ids always match).
  id: string;
  // Root-relative module path the client manifest imports for this reference.
  specifier: string;
}

export interface ServerTransformResult {
  clientRefs: ClientRef[];
  code: string;
  map: unknown;
}

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

  const result = await babel.transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: id,
    sourceMaps: true,
    presets: [
      [
        presetTypescript,
        { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true },
      ],
    ],
    plugins: [serverComponentBabelPlugin({ clientRefs, importerDir, root })],
  });

  return {
    clientRefs,
    code: result?.code ?? code,
    map: result?.map,
  };
}

function serverComponentBabelPlugin(state: {
  clientRefs: ClientRef[];
  importerDir: string;
  root: string;
}): (api: typeof babel) => PluginObj {
  return (api) => {
    const t = api.types;
    let needsImport = false;

    return {
      name: "fig-start-server",
      visitor: {
        Program: {
          exit(path) {
            if (!needsImport) return;
            path.node.body.unshift(
              api.template.statement.ast(
                `import { clientReference as __figClientRef } from "@bgub/fig";`,
              ),
            );
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
            if (t.isImportDefaultSpecifier(spec)) {
              exportName = "default";
            } else if (t.isImportSpecifier(spec)) {
              exportName = t.isIdentifier(spec.imported)
                ? spec.imported.name
                : spec.imported.value;
            } else {
              continue; // namespace imports are unsupported for client refs
            }

            const id = clientRefId(specifier, exportName);
            state.clientRefs.push({ id, specifier });
            declarations.push(
              api.template.statement.ast(
                `const ${spec.local.name} = __figClientRef({ id: ${JSON.stringify(
                  id,
                )}, load: () => Promise.resolve({}) });`,
              ),
            );
          }

          if (declarations.length === 0) return;
          needsImport = true;
          path.replaceWithMultiple(declarations as never[]);
        },
      },
    };
  };
}
