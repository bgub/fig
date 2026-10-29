import { fileURLToPath } from "node:url";

import { libraries } from "./library-entries.ts";

const entries = Object.entries(libraries).flatMap(([path, library]) =>
  Object.entries(library.entries).map(
    ([subpath, entry]) =>
      [
        subpath === "." ? library.name : `${library.name}${subpath.slice(1)}`,
        `${path}/${entry.source.slice(2)}`,
      ] as const,
  ),
);

export function figSourceAliases(): Record<string, string> {
  return Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => b.length - a.length)
      .map(([name, path]) => [name, workspacePath(path)]),
  );
}

export function figSourceResolveAliases(): Array<{
  find: RegExp;
  replacement: string;
}> {
  return entries.map(([name, path]) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: workspacePath(path),
  }));
}

export function workspacePath(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}
