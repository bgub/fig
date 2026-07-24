import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import {
  developmentLibraryPaths,
  libraryEntries,
} from "../../tsdown.config.ts";

const developmentCondition = "fig-development";

interface PackageManifest {
  exports: Record<string, string | Record<string, string>>;
  files?: string[];
  name: string;
}

void test("development artifacts cover every gated package export", async () => {
  const gatedPackages = (
    await Promise.all(
      Object.keys(libraryEntries).map(async (packagePath) =>
        (await directoryContainsGate(join(packagePath, "src")))
          ? packagePath
          : undefined,
      ),
    )
  ).filter((path): path is string => path !== undefined);

  assert.deepEqual(
    gatedPackages.sort(),
    [...developmentLibraryPaths].sort(),
    "The development build list must match packages containing __FIG_DEV__ gates.",
  );

  for (const packagePath of developmentLibraryPaths) {
    const manifest = JSON.parse(
      await readFile(join(packagePath, "package.json"), "utf8"),
    ) as PackageManifest;
    const outputs = configuredOutputs(libraryEntries[packagePath]);

    assert.ok(
      manifest.files?.includes("dist-development"),
      `${manifest.name} must publish dist-development.`,
    );

    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target === "string") continue;

      const productionTarget = target.import;
      assert.ok(
        productionTarget?.startsWith("./dist/"),
        `${manifest.name} ${subpath} must have a production import target.`,
      );
      const output = productionTarget.slice("./dist/".length);
      assert.ok(
        outputs.has(output),
        `${manifest.name} ${subpath} points to an unconfigured output: ${output}.`,
      );
      assert.equal(
        target[developmentCondition],
        `./dist-development/${output}`,
        `${manifest.name} ${subpath} must mirror its import target under ${developmentCondition}.`,
      );
    }
  }
});

async function directoryContainsGate(directory: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsGate(path)) return true;
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    if (/^\s*declare const __FIG_DEV__/m.test(await readFile(path, "utf8"))) {
      return true;
    }
  }
  return false;
}

function configuredOutputs(
  entries: string[] | Record<string, string> | undefined,
): Set<string> {
  assert.ok(entries !== undefined);
  return new Set(
    Array.isArray(entries)
      ? entries.map((entry) => `${basename(entry).replace(/\.[^.]+$/, "")}.js`)
      : Object.keys(entries).map((entry) => `${entry}.js`),
  );
}
