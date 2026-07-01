import { describe, expect, it } from "vite-plus/test";
import { contentTypeFor } from "./content-type.ts";

describe("contentTypeFor", () => {
  it("maps common build artifact extensions", () => {
    expect(contentTypeFor("/assets/client.js")).toContain("text/javascript");
    expect(contentTypeFor("/assets/style.css")).toContain("text/css");
    expect(contentTypeFor("/assets/client.js.map")).toContain(
      "application/json",
    );
    expect(contentTypeFor("/assets/data.json")).toContain("application/json");
    expect(contentTypeFor("/assets/module.wasm")).toBe("application/wasm");
    expect(contentTypeFor("/assets/font.woff")).toBe("font/woff");
    expect(contentTypeFor("/assets/font.woff2")).toBe("font/woff2");
  });
});
