import * as babel from "@babel/core";
import type { NodePath } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";

export const payloadPackageId = "@bgub/fig-tanstack-start/payload";
export const serverPackageId = "@bgub/fig-tanstack-start/server";

// One home for what counts as a source module: the manifest glob and the
// compiler analysis gates must accept the same files.
export const sourceModuleExtensions = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "cjs",
  "mjs",
  "cts",
  "mts",
] as const;

const sourceModulePattern = new RegExp(
  `\\.(?:${sourceModuleExtensions.join("|")})$`,
);

export function babelOptions(
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

export function isSourceModule(id: string): boolean {
  return sourceModulePattern.test(id);
}

export function isComponentName(name: string): boolean {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 65 && first <= 90;
}

export function isImportedBinding(
  path: NodePath,
  localName: string,
  importedName: string,
  source: string,
): boolean {
  const binding = path.scope.getBinding(localName);
  if (!binding?.path.isImportSpecifier()) return false;
  const imported = binding.path.node.imported;
  const actualName =
    imported.type === "Identifier" ? imported.name : imported.value;
  return (
    actualName === importedName &&
    binding.path.parentPath.isImportDeclaration() &&
    binding.path.parentPath.node.source.value === source
  );
}
