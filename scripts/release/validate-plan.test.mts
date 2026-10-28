import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { validateReleaseLock } from "./validate-plan.mts";

const id = "npm:@bgub/fig-headless";
const tags = new Map([[id, "alpha"]]);
const lock = {
  "core:packages": [{ id, updated: true }],
  "npm:packages": [{ id, distTag: "alpha" }],
};

void test("release locks retain the configured package tag", () => {
  assert.doesNotThrow(() => validateReleaseLock(lock, tags, [id]));
  assert.throws(() => validateReleaseLock(lock, tags, ["npm:@bgub/fig"]));
});

void test("unchanged packages may be retained alongside a versioned package", () => {
  const core = "npm:@bgub/fig";
  assert.doesNotThrow(() =>
    validateReleaseLock(
      {
        "core:packages": [
          ...lock["core:packages"],
          { id: core, updated: false },
        ],
        "npm:packages": [
          ...lock["npm:packages"],
          { id: core, distTag: "latest" },
        ],
      },
      new Map([...tags, [core, "latest"]]),
    ),
  );
});

void test("malformed, empty, or unknown publish plans cannot silently pass", () => {
  assert.throws(() => parse("core:packages: [unterminated"));
  for (const candidate of [
    {},
    { ...lock, "core:packages": [] },
    { ...lock, "core:packages": [{ id: "npm:@bgub/unknown", updated: true }] },
    { ...lock, "core:packages": [{ id, updated: false }] },
    {
      ...lock,
      "core:packages": [lock["core:packages"][0]!, lock["core:packages"][0]!],
    },
    { ...lock, "npm:packages": [] },
    { ...lock, "npm:packages": [{ id, distTag: "latest" }] },
    {
      ...lock,
      "npm:packages": [lock["npm:packages"][0]!, lock["npm:packages"][0]!],
    },
  ])
    assert.throws(() => validateReleaseLock(candidate, tags));
});
