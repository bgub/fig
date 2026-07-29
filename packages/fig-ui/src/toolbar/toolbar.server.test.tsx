import { renderToHtml } from "@bgub/fig-server";
import { describe, expect, it } from "vitest";
import { Toolbar } from "./toolbar.tsx";

describe("Toolbar server rendering", () => {
  it("leaves native controls reachable before roving focus hydrates", async () => {
    const html = await renderToHtml(
      <Toolbar>
        {(toolbar) => (
          <div aria-label="Formatting" mix={toolbar.root()}>
            <button mix={toolbar.item("bold")}>Bold</button>
            <button mix={toolbar.item("italic")}>Italic</button>
          </div>
        )}
      </Toolbar>,
    );

    expect(html).toContain('role="toolbar"');
    expect(html).not.toContain('tabindex="-1"');
  });
});
