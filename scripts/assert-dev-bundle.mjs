// Demo bundles must be dev builds: Fig's dev-only paths (DevTools emission,
// diagnostics) are gated on the compile-time __FIG_DEV__ define, and unit
// tests always run source-linked with the dev define, so a missing or wrong
// define in a demo pack config is invisible to `vp test`. This runs right
// after `vp pack` and fails the build instead.
//
// Usage: node scripts/assert-dev-bundle.mjs <bundle.js> [...more bundles]
import { readFileSync } from "node:fs";

const bundles = process.argv.slice(2);
if (bundles.length === 0) {
  console.error("assert-dev-bundle: pass at least one bundle path");
  process.exit(1);
}

for (const bundle of bundles) {
  const source = readFileSync(bundle, "utf8");

  if (!source.includes("emitDevtoolsCommit")) {
    console.error(
      `assert-dev-bundle: ${bundle} lost Fig's DevTools emission — the pack ` +
        "config no longer defines __FIG_DEV__ as true (see vite.config.ts).",
    );
    process.exit(1);
  }

  if (source.includes("__FIG_DEV__")) {
    console.error(
      `assert-dev-bundle: ${bundle} still references __FIG_DEV__ — the ` +
        "define was not applied, so dev gates silently resolve to false at " +
        "runtime.",
    );
    process.exit(1);
  }
}
