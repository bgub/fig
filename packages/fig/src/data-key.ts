interface EncodePath {
  root: string;
  segments: Array<string | number>;
}

/** Canonical JSON for data keys, argument fingerprints, and store partitions. */
export function encodeDataKeyInput(value: unknown, root: string): string {
  return encodeValue(value, createEncodePath(root));
}

function createEncodePath(root: string): EncodePath {
  return { root, segments: [] };
}

function formatEncodePath(path: EncodePath): string {
  let text = path.root;
  for (const segment of path.segments) {
    text += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
  }
  return text;
}

function encodeArray(values: readonly unknown[], path: EncodePath): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    path.segments.push(index);
    parts.push(encodeValue(values[index], path));
    path.segments.pop();
  }
  return `[${parts.join(",")}]`;
}

function encodeObject(value: object, path: EncodePath): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `Invalid data resource key value at ${formatEncodePath(path)}.`,
    );
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const child = record[key];
    if (child === undefined) {
      throw new Error(
        `Invalid undefined data resource key value at ${formatEncodePath(path)}.`,
      );
    }
    path.segments.push(key);
    parts.push(`${JSON.stringify(key)}:${encodeValue(child, path)}`);
    path.segments.pop();
  }

  return `{${parts.join(",")}}`;
}

function encodeValue(value: unknown, path: EncodePath): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `Invalid number in data resource key at ${formatEncodePath(path)}.`,
        );
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return encodeArray(value, path);
      return encodeObject(value, path);
    default:
      throw new Error(
        `Invalid data resource key value at ${formatEncodePath(path)}.`,
      );
  }
}
