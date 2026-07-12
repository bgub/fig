import { describe, expect, it } from "vitest";
import { figRefresh } from "./index.ts";

describe("@bgub/fig-vite plugin", () => {
  it("loads the refresh runtime through Vite file imports", () => {
    const plugin = figRefresh();
    const id = plugin.resolveId("virtual:fig-refresh");
    const code = id === null ? null : plugin.load(id);

    expect(code).toContain('from "/@fs/');
    expect(code).toContain("fig-refresh");
    expect(code).toContain("fig-dom");
  });

  it("skips refresh transforms during SSR evaluation", async () => {
    const plugin = figRefresh();
    const source = `export function Counter() {
  return <div />;
}`;

    expect(
      await plugin.transform(source, "/app/src/Counter.tsx", { ssr: true }),
    ).toBeNull();
  });
});
