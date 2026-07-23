import type { DataResourceKeyInput } from "@bgub/fig";

export function encodePayloadKey(value: unknown): DataResourceKeyInput {
  const ids = new WeakMap<object, number>();
  let nextId = 1;

  function encode(value: unknown): DataResourceKeyInput {
    if (value === null) return null;
    if (value === undefined) return ["undefined"];
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (Number.isNaN(value)) return ["number", "NaN"];
      if (value === Infinity) return ["number", "Infinity"];
      if (value === -Infinity) return ["number", "-Infinity"];
      return Object.is(value, -0) ? ["number", "-0"] : value;
    }
    if (typeof value === "bigint") return ["bigint", value.toString()];
    if (typeof value === "symbol") {
      const key = Symbol.keyFor(value);
      if (key === undefined) {
        throw new Error("Only global Symbol.for symbols can be serialized.");
      }
      return ["symbol", key];
    }
    if (typeof value === "function") {
      throw new Error("Functions cannot be serialized into the payload.");
    }
    if (value instanceof Date) {
      const json = value.toJSON();
      if (json === null) {
        throw new Error("Invalid Date values cannot be serialized.");
      }
      return ["date", json];
    }

    const existing = ids.get(value);
    if (existing !== undefined) return ["ref", existing];
    const id = nextId++;
    ids.set(value, id);

    if (Array.isArray(value)) {
      return ["array", id, value.map(encode)];
    }
    if (value instanceof Map) {
      return [
        "map",
        id,
        Array.from(value, ([key, item]) => [encode(key), encode(item)]),
      ];
    }
    if (value instanceof Set) {
      return ["set", id, Array.from(value, encode)];
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Cannot serialize ${prototype?.constructor?.name ?? "object"} into the payload.`,
      );
    }
    const record = value as Record<string, unknown>;
    return [
      "object",
      id,
      Object.keys(record)
        .sort()
        .map((key) => [key, encode(record[key])]),
    ];
  }

  return encode(value);
}
