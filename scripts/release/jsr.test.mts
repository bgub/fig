import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFigRelease, publicPackageNames } from "./config.mts";
import { jsrRelease, synchronizeJsrManifest } from "./jsr.mts";

void test("release graph contains one synchronized public group", async () => {
  const context = await createFigRelease()._internal.context();
  assert.deepEqual(
    context.graph
      .getPackages()
      .map((pkg) => pkg.name)
      .sort(),
    [...publicPackageNames].sort(),
  );

  const group = context.graph.getGroup("fig");
  assert.ok(group !== undefined);
  assert.equal(group.options.prerelease, "alpha");
  assert.equal(group.options.syncBump, true);
  assert.equal(group.options.syncGitTag, true);
  assert.deepEqual(
    group.packages.map((pkg) => pkg.name).sort(),
    [...publicPackageNames].sort(),
  );
});

void test("synchronizeJsrManifest updates only the version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fig-jsr-release-"));
  const path = join(dir, "jsr.json");
  await writeFile(
    path,
    `${JSON.stringify({ name: "@bgub/fig", version: "0.0.1", exports: "./src/index.ts" }, null, 2)}\n`,
  );

  assert.equal(
    await synchronizeJsrManifest(path, "@bgub/fig", "0.1.0-alpha.0"),
    true,
  );
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    name: "@bgub/fig",
    version: "0.1.0-alpha.0",
    exports: "./src/index.ts",
  });
  assert.equal(
    await synchronizeJsrManifest(path, "@bgub/fig", "0.1.0-alpha.0"),
    false,
  );
});

void test("synchronizeJsrManifest rejects the wrong package", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fig-jsr-release-"));
  const path = join(dir, "jsr.json");
  await writeFile(path, '{"name":"@bgub/not-fig","version":"0.0.1"}\n');

  await assert.rejects(
    synchronizeJsrManifest(path, "@bgub/fig", "0.0.2"),
    /expected @bgub\/fig/,
  );
});

void test("jsrRelease validates unpublished packages during dry runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fig-jsr-release-"));
  await writeFile(
    join(dir, "jsr.json"),
    '{"name":"@bgub/fig","version":"0.0.2-alpha.0"}\n',
  );

  const commands: Array<{ command: string; args: string[]; cwd: string }> = [];
  const plugin = jsrRelease({
    fetch: async () => new Response(null, { status: 404 }),
    run: async (command, args, cwd) => {
      commands.push({ command, args, cwd });
    },
  });
  const id = "npm:@bgub/fig";
  const pkg = {
    id,
    name: "@bgub/fig",
    path: dir,
    version: "0.0.2-alpha.0",
  };
  const plan = {
    options: { dryRun: true },
    changelogs: new Map(),
    packages: new Map([
      [
        id,
        {
          changelogs: [],
          updated: true,
          preflight: { shouldPublish: true },
        },
      ],
    ]),
  };
  const context = {
    graph: { get: (requested: string) => (requested === id ? pkg : undefined) },
  };

  await plugin.beforePublishAll?.call(context as never, { plan } as never);

  assert.deepEqual(commands, [
    {
      command: "pnpm",
      args: ["exec", "jsr", "publish", "--allow-slow-types", "--dry-run"],
      cwd: dir,
    },
  ]);
});
