import figManifest from "../../fig/package.json";
import figDevtoolsManifest from "../../fig-devtools/package.json";
import figStartManifest from "../package.json";
import figViteManifest from "../../fig-vite/package.json";
import { describe, expect, it } from "vitest";

describe("release readiness", () => {
  it("keeps unreleased workspace packages private", () => {
    expect(figDevtoolsManifest.private).toBe(true);
    expect(figStartManifest.private).toBe(true);
    expect(figViteManifest.private).toBe(true);
  });

  it("routes browser imports of @bgub/fig/server to the throwing stub", () => {
    expect(figManifest.exports["./server"].browser).toBe(
      "./dist/server.browser.js",
    );
  });
});
