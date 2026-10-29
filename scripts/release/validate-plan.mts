import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createFigRelease } from "./config.mts";

interface PublishLockData {
  "core:packages"?: Array<{ id: string; updated: boolean }>;
  "npm:packages"?: Array<{ id: string; distTag?: string }>;
}

/** Reject locks that Tegami would silently ignore or prune to an empty plan. */
export function validateReleaseLock(
  lock: PublishLockData,
  expectedTags: ReadonlyMap<string, string>,
  requiredPackages: readonly string[] = [],
): void {
  const packages = lock?.["core:packages"];
  const npm = lock?.["npm:packages"];
  assert.ok(
    Array.isArray(packages) && packages.length > 0,
    "The publish lock needs packages.",
  );
  assert.ok(Array.isArray(npm), "The publish lock needs npm metadata.");
  const seen = new Set<string>();
  for (const pkg of packages) {
    assert.ok(
      pkg && expectedTags.has(pkg.id),
      `Unknown publish package: ${pkg?.id}`,
    );
    assert.equal(
      typeof pkg.updated,
      "boolean",
      `${pkg.id} needs its versioned flag.`,
    );
    assert.ok(!seen.has(pkg.id), `Duplicate publish package: ${pkg.id}`);
    seen.add(pkg.id);
    const entries: NonNullable<PublishLockData["npm:packages"]> = npm.filter(
      (entry) => entry.id === pkg.id,
    );
    assert.equal(entries.length, 1, `${pkg.id} must have one npm entry.`);
    assert.equal(
      entries[0]!.distTag,
      expectedTags.get(pkg.id),
      `${pkg.id} has the wrong npm tag.`,
    );
  }
  assert.ok(
    packages.some((pkg) => pkg.updated),
    "The publish lock needs a versioned package.",
  );
  for (const id of requiredPackages) {
    assert.ok(
      packages.some((pkg) => pkg.id === id && pkg.updated),
      `Versioned package is missing from the publish lock: ${id}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = createFigRelease();
  const context = await release._internal.context();
  const expectedTags = new Map(
    context.graph
      .getPackages()
      .map((pkg) => [
        pkg.id,
        pkg.options.npm?.distTag ?? pkg.group?.options.npm?.distTag ?? "latest",
      ]),
  );
  validateReleaseLock(
    parse(await readFile(context.lockPath, "utf8")),
    expectedTags,
    JSON.parse(process.env.RELEASE_PACKAGES ?? "[]"),
  );
  const status = await release.getPublishStatus({ dryRun: true });
  assert.notEqual(
    status.status,
    "none",
    "Tegami could not read the publish plan.",
  );
  await release.publish({ dryRun: true });
  console.log("Publish lock and Tegami dry run passed.");
}
