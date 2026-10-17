import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publicPackageNames, runtimePackageNames } from "./config.mts";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "fig-release-consumer-"));
const consumer = join(temporary, "consumer");
const tarballs = join(temporary, "tarballs");

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

try {
  await mkdir(consumer);
  await mkdir(tarballs);
  const manifests = await Promise.all(
    publicPackageNames.map(async (name) =>
      JSON.parse(
        await readFile(
          join(root, "packages", name.slice("@bgub/".length), "package.json"),
          "utf8",
        ),
      ),
    ),
  );
  for (const manifest of manifests) {
    assert.equal(
      manifest.private,
      undefined,
      `${manifest.name} must be public`,
    );
    run(
      "pnpm",
      ["pack", "--pack-destination", tarballs],
      join(root, "packages", manifest.name.slice("@bgub/".length)),
    );
  }
  const helpers: Record<string, string> = {};
  for (const name of ["happy-dom", "@types/node", "vite"]) {
    helpers[name] = JSON.parse(
      await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
    ).version;
  }
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "fig-release-consumer",
      private: true,
      type: "module",
      devDependencies: helpers,
    }),
  );
  const packages = (await readdir(tarballs)).filter((file) =>
    file.endsWith(".tgz"),
  );
  assert.equal(packages.length, publicPackageNames.length);
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--strict-peer-deps",
      "--no-audit",
      "--no-fund",
      ...packages.map((file) => join(tarballs, file)),
    ],
    consumer,
  );
  await writeFile(join(consumer, "packages.json"), JSON.stringify(manifests));
  await cp(join(root, "scripts/release/fixtures"), consumer, {
    recursive: true,
  });
  const imports = manifests.flatMap((manifest) =>
    Object.keys(manifest.exports)
      .filter((entry) => entry !== "./package.json")
      .map((entry) =>
        entry === "." ? manifest.name : manifest.name + entry.slice(1),
      ),
  );
  function importSource(entries: string[]) {
    return entries
      .map(
        (entry, index) =>
          `import * as entry${index} from ${JSON.stringify(entry)};\nvoid entry${index};`,
      )
      .join("\n");
  }
  await writeFile(join(consumer, "entries.ts"), importSource(imports));
  const runtimeNames = [...runtimePackageNames, "@bgub/fig-headless"];
  await writeFile(
    join(consumer, "runtime-entries.ts"),
    importSource(
      imports.filter((entry) =>
        runtimeNames.some(
          (name) => entry === name || entry.startsWith(`${name}/`),
        ),
      ),
    ),
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        strict: true,
        // Tooling pulls in third-party declarations for optional bundlers.
        // Match the repo here; check Fig runtime declarations separately below.
        skipLibCheck: true,
        noEmit: true,
        jsx: "react-jsx",
        jsxImportSource: "@bgub/fig-dom",
        types: ["node"],
      },
      include: ["entries.ts", "types.tsx"],
    }),
  );
  run(
    resolve(root, "node_modules/.bin/tsc"),
    ["--project", join(consumer, "tsconfig.json")],
    consumer,
  );
  await writeFile(
    join(consumer, "tsconfig.runtime.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { skipLibCheck: false },
      include: ["runtime-entries.ts", "types.tsx"],
    }),
  );
  run(
    resolve(root, "node_modules/.bin/tsc"),
    ["--project", join(consumer, "tsconfig.runtime.json")],
    consumer,
  );
  for (const conditions of [[], ["--conditions=fig-development"]]) {
    run(process.execPath, [...conditions, "entries.mjs"], consumer);
    run(process.execPath, [...conditions, "smoke.mjs"], consumer);
  }
  run(
    resolve(consumer, "node_modules/.bin/vite"),
    ["build", "--config", "vite.config.cjs"],
    join(consumer, "start"),
  );
  run(process.execPath, ["start-smoke.mjs"], consumer);
  console.log(
    `Packed consumer checks passed for ${manifests.length} packages and ${imports.length} entries.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
