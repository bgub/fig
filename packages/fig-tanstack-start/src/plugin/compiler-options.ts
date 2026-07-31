import type { NodePath, PluginItem } from "@babel/core";
import { tanStackCompatibilityProfile } from "./compatibility-profile.ts";

interface CompilerTransformOptions {
  plugins: PluginItem[];
  sourceMaps?: true;
}

const figStartPackage = tanStackCompatibilityProfile.packages.figStart;

export const payloadPackageId = `${figStartPackage}/payload`;
export const serverPackageId = `${figStartPackage}/server`;

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

const sourceModuleSuffix = `\\.(?:${sourceModuleExtensions.join("|")})`;
const sourceModulePattern = new RegExp(`${sourceModuleSuffix}$`);
const compilerSourceIdPattern = new RegExp(`${sourceModuleSuffix}(?:\\?.*)?$`);
const dependencyModuleIdPattern = /(?:^|[\\/])node_modules[\\/]/;
export const compilerSourceIdFilter = {
  include: compilerSourceIdPattern,
  exclude: dependencyModuleIdPattern,
} as const;

let babelCompiler: ReturnType<typeof loadBabelCompiler> | undefined;

export async function transformWithBabel(
  code: string,
  filename: string,
  { plugins, sourceMaps }: CompilerTransformOptions,
) {
  const { babel, presetTypescript } = await (babelCompiler ??=
    loadBabelCompiler());
  return babel.transformAsync(code, {
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
    plugins,
    sourceMaps,
  });
}

async function loadBabelCompiler() {
  const [babel, { default: presetTypescript }] = await Promise.all([
    import("@babel/core"),
    import("@babel/preset-typescript"),
  ]);
  return { babel, presetTypescript };
}

export function isSourceModule(id: string): boolean {
  return sourceModulePattern.test(id);
}

export function isCompilerSourceModule(id: string): boolean {
  return (
    compilerSourceIdPattern.test(id) && !dependencyModuleIdPattern.test(id)
  );
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
