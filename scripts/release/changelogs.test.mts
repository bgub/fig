import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFigRelease } from "./config.mts";

void test("all repository changelogs are recognized by Tegami", async () => {
  await createFigRelease().draft();
});

void test("release drafts reject silently ignored changelogs before applying versions", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "fig-changelog-validation-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "fig", private: true }),
  );
  await writeFile(
    join(cwd, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  await mkdir(join(cwd, "packages/fig"), { recursive: true });
  await writeFile(
    join(cwd, "packages/fig/package.json"),
    JSON.stringify({ name: "@bgub/fig", version: "2.1.0" }),
  );
  // A new workspace without changelogs is valid.
  assert.equal((await createFigRelease(cwd).draft()).hasPending(), false);
  await mkdir(join(cwd, ".tegami"));
  const filename = join(cwd, ".tegami/change.md");
  const frontmatter =
    '---\npackages:\n  "@bgub/fig":\n    type: patch\n---\n\n';
  for (const [name, content] of [
    ["missing heading", frontmatter + "Fix a bug.\n"],
    [
      "heading only inside a fence",
      frontmatter + "```md\n## Not a section\n```\n",
    ],
    ["missing frontmatter", "## Fix a bug\n"],
    ["invalid bump", frontmatter.replace("patch", "banana") + "## Fix a bug\n"],
  ]) {
    await t.test(name, async () => {
      await writeFile(filename, content);
      await assert.rejects(
        createFigRelease(cwd).draft(),
        /Tegami ignored changelog files: change\.md/,
      );
    });
  }
  await t.test("unknown package", async () => {
    await writeFile(
      filename,
      frontmatter.replace("@bgub/fig", "@bgub/typo") + "## Fix a bug\n",
    );
    await assert.rejects(
      createFigRelease(cwd).draft(),
      /change\.md: unknown release package @bgub\/typo/,
    );
  });
  await t.test("valid entry", async () => {
    await writeFile(filename, frontmatter + "## Fix a bug\n\nDetails.\n");
    const draft = await createFigRelease(cwd).draft();
    assert.equal(draft.hasPending(), true);
    assert.equal(draft.getChangelogs().length, 1);
  });
  await t.test("replay-only entry", async () => {
    await writeFile(
      filename,
      '---\npackages:\n  "@bgub/fig":\n    replay:\n      - exit-prerelease(npm:@bgub/fig)\n---\n\n## Keep for stable release\n',
    );
    const draft = await createFigRelease(cwd).draft();
    assert.equal(draft.hasPending(), false);
    assert.equal(draft.getChangelogs().length, 1);
  });
});
