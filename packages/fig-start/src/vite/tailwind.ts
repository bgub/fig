import type { FigStartPluginOptions } from "./index.ts";

export async function transformTailwindCss(
  code: string,
  id: string,
  root: string,
  options: Exclude<FigStartPluginOptions["tailwind"], false | undefined>,
): Promise<{ code: string; map: unknown }> {
  const [{ default: postcss }, { default: tailwindcss }] = await Promise.all([
    import("postcss"),
    import("@tailwindcss/postcss"),
  ]);
  const base = typeof options === "object" ? options.base : undefined;
  const result = await postcss([
    tailwindcss({ base: base ?? root }),
  ]).process(code, {
    from: id,
    map: { annotation: false, inline: false },
    to: id,
  });
  return { code: result.css, map: result.map?.toJSON() ?? null };
}

export function isTailwindCssEntry(code: string): boolean {
  return /@import\s+["']tailwindcss["']|@tailwind\b/.test(code);
}
