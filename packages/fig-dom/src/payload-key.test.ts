import { describe, expect, it } from "vitest";
import { encodePayloadKey } from "./payload-key.ts";

describe("encodePayloadKey", () => {
  it("canonicalizes plain-object property order before assigning graph ids", () => {
    expect(
      encodePayloadKey({ filters: ["active"], sort: { field: "name" } }),
    ).toEqual(
      encodePayloadKey({ sort: { field: "name" }, filters: ["active"] }),
    );
  });

  it("preserves shared and cyclic graph identity", () => {
    const shared = { value: 1 };
    const sharedGraph = { first: shared, second: shared };
    const copiedGraph = { first: { value: 1 }, second: { value: 1 } };
    expect(encodePayloadKey(sharedGraph)).not.toEqual(
      encodePayloadKey(copiedGraph),
    );

    const first: { self?: unknown } = {};
    const second: { self?: unknown } = {};
    first.self = first;
    second.self = second;
    expect(encodePayloadKey(first)).toEqual(encodePayloadKey(second));
  });

  it("supports Payload value types", () => {
    const values = {
      bigint: 1n,
      date: new Date("2020-01-01T00:00:00.000Z"),
      map: new Map([["key", undefined]]),
      numbers: [NaN, Infinity, -Infinity, -0],
      set: new Set([Symbol.for("value")]),
    };

    expect(() => encodePayloadKey(values)).not.toThrow();
    expect(encodePayloadKey(-0)).not.toEqual(encodePayloadKey(0));
  });

  it("rejects values Payload cannot serialize", () => {
    class Instance {}

    expect(() => encodePayloadKey(Symbol("local"))).toThrow(
      "Only global Symbol.for symbols can be serialized.",
    );
    expect(() => encodePayloadKey(new Date(NaN))).toThrow(
      "Invalid Date values cannot be serialized.",
    );
    expect(() => encodePayloadKey(new Instance())).toThrow(
      "Cannot serialize Instance into the payload.",
    );
    expect(() => encodePayloadKey(() => undefined)).toThrow(
      "Functions cannot be serialized into the payload.",
    );
  });
});
