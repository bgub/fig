import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { libraries, libraryEntries } from "../lib/library-entries.ts";
import {
  figSourceAliases,
  figSourceResolveAliases,
  workspacePath,
} from "../lib/fig-source-aliases.ts";

interface PackageManifest {
  name: string;
  exports: Record<string, string | { types: string; import: string }>;
}

void test("library entries cover package exports and resolve to buildable source", async () => {
  const packagePaths = (await readdir("packages", { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join("packages", entry.name, "package.json")),
    )
    .map((entry) => `packages/${entry.name}`);
  assert.deepEqual(Object.keys(libraries).sort(), packagePaths.sort());
  const aliases = figSourceAliases();
  const resolveAliases = figSourceResolveAliases();
  for (const [path, library] of Object.entries(libraries)) {
    const manifest = JSON.parse(
      await readFile(join(path, "package.json"), "utf8"),
    ) as PackageManifest;
    assert.equal(library.name, manifest.name);
    assert.deepEqual(
      Object.keys(library.entries).sort(),
      Object.keys(manifest.exports)
        .filter((key) => key !== "./package.json")
        .sort(),
      path,
    );
    const outputs = new Map(Object.entries(library.internalEntries ?? {}));
    for (const [output, source] of outputs) {
      await access(join(path, source));
      assert.equal(libraryEntries[path]?.[output], source);
    }
    for (const [subpath, { source, output }] of Object.entries(
      library.entries,
    )) {
      const target = manifest.exports[subpath];
      assert.ok(typeof target === "object", `${library.name}${subpath}`);
      assert.equal(target.import, `./dist/${output}.js`);
      assert.equal(target.types, `./dist/${output}.d.ts`);
      assert.ok(
        !outputs.has(output) || outputs.get(output) === source,
        `Conflicting sources for ${path}/${output}`,
      );
      outputs.set(output, source);
      await access(join(path, source));
      assert.equal(libraryEntries[path]?.[output], source);
      const specifier =
        subpath === "." ? library.name : `${library.name}${subpath.slice(1)}`;
      const expected = workspacePath(`${path}/${source.slice(2)}`);
      assert.equal(aliases[specifier], expected);
      assert.equal(
        resolveAliases.find((alias) => alias.find.test(specifier))?.replacement,
        expected,
      );
      assert.ok(
        !resolveAliases.some((alias) =>
          alias.find.test(`${specifier}/not-an-export`),
        ),
      );
    }
  }
});

void test("quality checks build every library before checking consumers", async () => {
  const turbo = JSON.parse(await readFile("turbo.json", "utf8")) as {
    tasks: Record<string, { dependsOn?: string[] }>;
  };
  const builds = Object.values(libraries)
    .map((library) => `${library.name}#build`)
    .sort();
  for (const task of ["//#lint", "//#lint:fix"]) {
    assert.deepEqual(turbo.tasks[task]?.dependsOn?.toSorted(), builds);
  }
});
