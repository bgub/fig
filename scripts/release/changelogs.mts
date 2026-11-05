import { readdir } from "node:fs/promises";
import type { Draft, TegamiContext } from "tegami";

/** Compare files with Tegami's parsed entries instead of duplicating its parser. */
export async function validateChangelogs(
  draft: Draft,
  context: TegamiContext,
): Promise<void> {
  const files = await readdir(context.changelogDir).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const entries = draft.getChangelogs();
  const parsed = new Set(entries.map((entry) => entry.filename));
  const ignored = files.filter(
    (file) => file.endsWith(".md") && !parsed.has(file),
  );
  if (ignored.length > 0) {
    throw new Error(
      `Tegami ignored changelog files: ${ignored.sort().join(", ")}. ` +
        "Each entry needs valid packages frontmatter and a Markdown heading such as ## Describe the change.",
    );
  }
  for (const entry of entries) {
    for (const name of entry.packages.keys()) {
      if (context.graph.getByName(name).length === 0) {
        throw new Error(`${entry.filename}: unknown release package ${name}.`);
      }
    }
  }
}
