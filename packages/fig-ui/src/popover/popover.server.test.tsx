import { renderToHtml } from "@bgub/fig-server";
import { describe, expect, it } from "vitest";
import { Popover } from "./popover.tsx";

describe("Popover server rendering", () => {
  it("emits the declarative trigger relationship before hydration", async () => {
    const html = await renderToHtml(
      <Popover id="filters-popover">
        {(popover) => (
          <>
            <button mix={popover.trigger()}>Filters</button>
            <div mix={popover.popover()}>Options</div>
          </>
        )}
      </Popover>,
    );

    expect(html).toContain('aria-controls="filters-popover"');
    expect(html).toContain('popovertarget="filters-popover"');
    expect(html).toContain('id="filters-popover"');
  });
});
