// Demo bundles must be dev builds: Fig's dev-only paths (DevTools emission,
// diagnostics) are gated on the compile-time __FIG_DEV__ define, and unit
// tests always run source-linked with the dev define, so a missing or wrong
// define in a demo bundle config is invisible to Vitest. Bundle configs run
// this via `onSuccess`, right where the define is granted, so every build
// (including --watch) fails instead.
//
// Usage: node scripts/assert-dev-bundle.mjs <bundle.js | dist-dir> [...more]
// A directory target scans its top-level .js files: at least one must carry
// the DevTools emitter (hash-named chunk layouts), and none may reference
// __FIG_DEV__.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  fail("pass at least one bundle or dist path");
}

function fail(message) {
  console.error(`assert-dev-bundle: ${message}`);
  process.exit(1);
}

for (const target of targets) {
  const bundles = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((name) => name.endsWith(".js"))
        .map((name) => join(target, name))
    : [target];
  if (bundles.length === 0) fail(`${target} contains no .js bundles`);

  let sawDevtoolsEmitter = false;
  for (const bundle of bundles) {
    const source = readFileSync(bundle, "utf8");
    if (source.includes("emitDevtoolsCommit")) sawDevtoolsEmitter = true;
    if (source.includes("__FIG_DEV__")) {
      fail(
        `${bundle} still references __FIG_DEV__ — the define was not ` +
          "applied, so dev gates silently resolve to false at runtime.",
      );
    }
  }

  if (!sawDevtoolsEmitter) {
    fail(
      `${target} lost Fig's DevTools emission — the pack config no longer ` +
        "defines __FIG_DEV__ as true (see vite.config.ts).",
    );
  }
}
