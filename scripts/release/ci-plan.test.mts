import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReleaseChanges,
  hasFullCiJobs,
  isSuccessfulMainRun,
  planCi,
  type ReleaseChange,
} from "./ci-plan.mts";

const manifest = {
  name: "@bgub/fig-reconciler",
  version: "1.0.0",
  scripts: { build: "pnpm build" },
  exports: { ".": "./dist/index.js" },
  peerDependencies: { "@bgub/fig": "1.0.0" },
  dependencies: { external: "^1.0.0" },
};
const versions = new Map([
  ["@bgub/fig", "2.0.0"],
  ["@bgub/fig-reconciler", "2.0.0"],
]);

function file(content: unknown, mode = "100644") {
  return { mode, content: JSON.stringify(content) };
}

function release(
  next: Record<string, unknown> = { ...manifest, version: "2.0.0" },
): ReleaseChange[] {
  return [
    {
      path: "packages/fig-reconciler/package.json",
      before: file(manifest),
      after: file(next),
    },
    { path: ".tegami/publish-lock.yaml", after: file("plan") },
  ];
}

void test("release versions, internal ranges, JSR versions, and changelogs qualify", () => {
  const changes = release({
    ...manifest,
    version: "2.0.0",
    peerDependencies: { "@bgub/fig": "^2.0.0" },
  });
  changes.push(
    { path: "packages/fig/CHANGELOG.md", after: file("release notes") },
    { path: ".tegami/change.md", before: file("consumed changelog") },
    {
      path: "packages/fig/jsr.json",
      before: file({
        name: "@bgub/fig",
        version: "1.0.0",
        exports: "./src/index.ts",
      }),
      after: file({
        name: "@bgub/fig",
        version: "2.0.0",
        exports: "./src/index.ts",
      }),
    },
  );
  assert.equal(classifyReleaseChanges(changes, versions).releaseOnly, true);
  assert.equal(
    classifyReleaseChanges(
      release({ ...manifest, version: "0.1.0-alpha.0" }),
      versions,
    ).releaseOnly,
    true,
  );
});

void test("source, workflow, lockfile, and unexpected release files require full CI", () => {
  for (const path of [
    "packages/fig/src/index.ts",
    ".github/workflows/ci.yml",
    "scripts/release/config.mts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    ".tegami/config.ts",
    "README.md",
  ]) {
    assert.equal(
      classifyReleaseChanges(
        [...release(), { path, after: file("changed") }],
        versions,
      ).releaseOnly,
      false,
      path,
    );
  }
});

void test("manifest changes beyond existing internal version ranges require full CI", () => {
  for (const next of [
    { ...manifest, scripts: { build: "changed" } },
    { ...manifest, exports: { ".": "./different.js" } },
    { ...manifest, dependencies: { external: "^2.0.0" } },
    { ...manifest, peerDependencies: { "@bgub/fig": "^3.0.0" } },
    { ...manifest, peerDependencies: {} },
    {
      ...manifest,
      peerDependencies: {
        "@bgub/fig": "2.0.0",
        "@bgub/fig-reconciler": "2.0.0",
      },
    },
    { ...manifest, private: true },
    { ...manifest, files: ["extra"] },
    { ...manifest, publishConfig: { tag: "next" } },
  ]) {
    assert.equal(
      classifyReleaseChanges(release({ ...next, version: "2.0.0" }), versions)
        .releaseOnly,
      false,
    );
  }
});

void test("new manifests, symlinks, deleted locks, and metadata without versions require full CI", () => {
  const changes = release();
  assert.equal(
    classifyReleaseChanges(
      [{ ...changes[0]!, before: undefined }, changes[1]!],
      versions,
    ).releaseOnly,
    false,
  );
  assert.equal(
    classifyReleaseChanges(
      [{ ...changes[0]!, after: file(manifest, "120000") }, changes[1]!],
      versions,
    ).releaseOnly,
    false,
  );
  assert.equal(
    classifyReleaseChanges(
      [changes[0]!, { ...changes[1]!, after: undefined }],
      versions,
    ).releaseOnly,
    false,
  );
  assert.equal(
    classifyReleaseChanges(release(manifest), versions).releaseOnly,
    false,
  );
  assert.equal(
    classifyReleaseChanges([changes[0]!], versions).releaseOnly,
    false,
  );
  assert.equal(classifyReleaseChanges([], versions).releaseOnly, false);
});

void test("CI evidence must be a successful push to main at the exact base SHA", () => {
  const run = {
    id: 1,
    head_sha: "base",
    head_branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  assert.equal(isSuccessfulMainRun(run, "base"), true);
  for (const other of [
    { ...run, head_sha: "other" },
    { ...run, head_branch: "feature" },
    { ...run, event: "pull_request" },
    { ...run, status: "in_progress" },
    { ...run, conclusion: "failure" },
  ])
    assert.equal(isSuccessfulMainRun(other, "base"), false);
});

void test("private-only version changes cannot select release validation", () => {
  const changes = release({ ...manifest, private: true, version: "2.0.0" });
  changes[0]!.before = file({ ...manifest, private: true });
  assert.equal(classifyReleaseChanges(changes, versions).releaseOnly, false);
});

void test("skipped jobs or test steps cannot stand in for full CI evidence", () => {
  const jobs = [
    {
      name: "checks",
      status: "completed",
      conclusion: "success",
      steps: [{ name: "Run pnpm test", conclusion: "success" }],
    },
    {
      name: "e2e",
      status: "completed",
      conclusion: "success",
      steps: [{ name: "Run pnpm test:e2e", conclusion: "success" }],
    },
  ];
  assert.equal(hasFullCiJobs(jobs), true);
  assert.equal(hasFullCiJobs(jobs.slice(0, 1)), false);
  assert.equal(
    hasFullCiJobs([jobs[0]!, { ...jobs[1]!, conclusion: "skipped" }]),
    false,
  );
  assert.equal(
    hasFullCiJobs([
      jobs[0]!,
      {
        ...jobs[1]!,
        steps: [{ name: "Run pnpm test:e2e", conclusion: "skipped" }],
      },
    ]),
    false,
  );
  assert.equal(hasFullCiJobs([jobs[0]!, { ...jobs[1]!, steps: [] }]), false);
});

void test("missing bases or unavailable history fall back to full CI", () => {
  for (const base of [undefined, "invalid", "0".repeat(40), "f".repeat(40)]) {
    assert.equal(planCi(base, "HEAD").releaseOnly, false);
  }
});
