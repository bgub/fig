import { describe, expect, it } from "vite-plus/test";
import {
  requireClientReferenceResolver,
  watchServerRouteLifetime,
} from "./client.ts";
import type { RouterState } from "./core.ts";

function fakeRouter(routeId: string | null) {
  let matches = routeId === null ? [] : [{ routeId }];
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ matches }) as unknown as RouterState,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    go(next: string | null) {
      matches = next === null ? [] : [{ routeId: next }];
      for (const listener of listeners) listener();
    },
  };
}

describe("@bgub/fig-start client server-route helpers", () => {
  it("throws when a payload has client refs but no resolver", () => {
    expect(() =>
      requireClientReferenceResolver(
        "/dash",
        { getClientReferences: () => [{ id: "app/Island.tsx#Island" }] },
        {},
      ),
    ).toThrow(/client-reference resolver/);
  });

  it("accepts a payload when a resolver is provided", () => {
    expect(() =>
      requireClientReferenceResolver(
        "/dash",
        { getClientReferences: () => [{ id: "app/Island.tsx#Island" }] },
        { loadClientReference: () => Promise.resolve({}) },
      ),
    ).not.toThrow();
  });

  it("accepts a payload with no client references", () => {
    expect(() =>
      requireClientReferenceResolver(
        "/dash",
        { getClientReferences: () => [] },
        {},
      ),
    ).not.toThrow();
  });

  it("disposes and unsubscribes when navigating away from the server route", () => {
    const router = fakeRouter("/dash");
    let disposed = 0;
    watchServerRouteLifetime(router, "/dash", () => {
      disposed += 1;
    });
    expect(router.listenerCount()).toBe(1);

    router.go("/dash"); // still active → no dispose
    expect(disposed).toBe(0);

    router.go("/other"); // navigated away → dispose + unsubscribe
    expect(disposed).toBe(1);
    expect(router.listenerCount()).toBe(0);

    router.go("/another"); // listener gone → no second dispose
    expect(disposed).toBe(1);
  });
});
