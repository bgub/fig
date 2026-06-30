import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contentTypeFor, resolveStaticFile } from "./static-server.mjs";

describe("dev static server helpers", () => {
  it("resolves root, files, directory indexes, and rejects traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "fig-dev-static-"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "index.html"), "home");
    await writeFile(join(root, "main.js"), "js");
    await writeFile(join(root, "docs", "index.html"), "docs");

    try {
      assert.equal(await resolveStaticFile(root, "/"), join(root, "index.html"));
      assert.equal(
        await resolveStaticFile(root, "/main.js"),
        join(root, "main.js"),
      );
      assert.equal(
        await resolveStaticFile(root, "/docs/"),
        join(root, "docs", "index.html"),
      );
      assert.equal(await resolveStaticFile(root, "/missing.js"), null);
      assert.equal(await resolveStaticFile(root, "/%2e%2e%2fsecret.js"), null);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("maps common dev asset content types", () => {
    assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
    assert.equal(contentTypeFor("style.css"), "text/css; charset=utf-8");
    assert.equal(contentTypeFor("main.js"), "text/javascript; charset=utf-8");
    assert.equal(contentTypeFor("data.json"), "application/json; charset=utf-8");
    assert.equal(
      contentTypeFor("main.js.map"),
      "application/json; charset=utf-8",
    );
    assert.equal(contentTypeFor("mark.svg"), "image/svg+xml");
    assert.equal(contentTypeFor("asset.bin"), "application/octet-stream");
  });
});
