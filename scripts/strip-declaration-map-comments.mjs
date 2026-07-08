import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const declarationMapComment = /\r?\n\/\/# sourceMappingURL=.*\.d\.ts\.map\s*$/u;

for (const root of process.argv.slice(2)) {
  await stripDeclarationMapComments(root);
}

async function stripDeclarationMapComments(path) {
  const entry = await stat(path);
  if (entry.isDirectory()) {
    const children = await readdir(path);
    await Promise.all(
      children.map((child) => stripDeclarationMapComments(join(path, child))),
    );
    return;
  }

  if (!path.endsWith(".d.ts")) return;

  const source = await readFile(path, "utf8");
  const next = source.replace(declarationMapComment, "");
  if (next !== source) await writeFile(path, next);
}
