import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writePublicAsset(
  path: string,
  source: string | Uint8Array,
): Promise<void> {
  const bytes = Buffer.from(source);
  let existing: Buffer | undefined;
  try {
    existing = await readFile(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  if (existing !== undefined) {
    if (existing.equals(bytes)) return;
    throw new Error(
      `TanStack Start server asset ${JSON.stringify(path)} conflicts with a different client asset at the same public path. Use content-hashed or separately namespaced asset file names.`,
    );
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
