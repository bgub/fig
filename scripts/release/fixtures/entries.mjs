import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const manifests = JSON.parse(await readFile("packages.json", "utf8"));
const development = process.execArgv.includes("--conditions=fig-development");
const startBundlerEntries = new Set([
  "@bgub/fig-tanstack-start/client",
  "@bgub/fig-tanstack-start/payload",
  "@bgub/fig-tanstack-start/server",
]);
for (const manifest of manifests) {
  const directory = resolve("node_modules", manifest.name);
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  const installed = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  );
  assert.equal(installed.version, manifest.version, manifest.name);
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json") continue;
    const specifier =
      subpath === "." ? manifest.name : manifest.name + subpath.slice(1);
    const expected =
      typeof target === "string"
        ? target
        : development && target["fig-development"]
          ? target["fig-development"]
          : target.import;
    assert.equal(
      fileURLToPath(import.meta.resolve(specifier)),
      resolve(directory, expected),
      specifier,
    );
    // Start's virtual modules are supplied by the plugin in the build below.
    if (!startBundlerEntries.has(specifier)) await import(specifier);
  }
}
console.log(
  `${development ? "Development" : "Production"} package entries resolve; Node entries import.`,
);
