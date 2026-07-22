import { describe, expect, it } from "vitest";
import {
  cleanModuleId,
  decodeOpaqueId,
  encodeOpaqueId,
  moduleQueryValue,
  toViteModulePath,
  withModuleQuery,
} from "./module-ids.ts";

describe("Vite module ids", () => {
  it("removes module query strings", () => {
    expect(cleanModuleId("/app/card.server.tsx?import")).toBe(
      "/app/card.server.tsx",
    );
  });

  it("round-trips opaque query values without disturbing fragments", () => {
    const encoded = encodeOpaqueId("/src/Counter.tsx#Counter");
    const id = withModuleQuery(
      "/app/Counter.tsx#fragment",
      "fig-reference",
      encoded,
    );

    expect(id).toContain("?fig-reference=");
    expect(id.endsWith("#fragment")).toBe(true);
    expect(decodeOpaqueId(moduleQueryValue(id, "fig-reference") ?? "")).toBe(
      "/src/Counter.tsx#Counter",
    );
  });

  it("uses root-relative ids inside the app and /@fs ids outside it", () => {
    expect(toViteModulePath("/app", "/app/src/Counter.tsx")).toBe(
      "/src/Counter.tsx",
    );
    expect(toViteModulePath("/app", "/shared/Counter.tsx")).toBe(
      "/@fs/shared/Counter.tsx",
    );
  });
});
