import { describe, expect, it } from "vitest";

// The consumer-era pure helpers (requireClientReferenceResolver,
// watchServerRouteLifetime) were deleted with the resource-model port:
// missing resolvers now fail loudly when a decoded island renders (the
// hydratable wrapper throws into the route's ErrorBoundary), and entry
// lifetime belongs to the data store (subscription + inactivity eviction).
// Their behaviors are covered by client-dom.test.ts against a real DOM.

describe("@bgub/fig-start client server-route helpers", () => {
  it("keeps the module importable without a DOM", async () => {
    const client = await import("./client.ts");
    expect(typeof client.hydrateStart).toBe("function");
    expect(typeof client.remoteDataLoader).toBe("function");
  });
});
