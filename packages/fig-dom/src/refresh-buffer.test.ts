import { describe, expect, it } from "vitest";
import { configureDomRefreshScheduler } from "./refresh-internal.ts";
import { type RefreshUpdate, scheduleRefresh } from "./refresh.ts";

// This file must not import ./index.ts: it exercises the window before the
// @bgub/fig-dom main entry evaluates and configures the scheduler.
function update(): RefreshUpdate {
  return { staleFamilies: new Set(), updatedFamilies: new Set() };
}

describe("@bgub/fig-dom refresh scheduling", () => {
  it("buffers updates until the renderer configures the scheduler", () => {
    const seen: RefreshUpdate[] = [];
    const first = update();
    const second = update();

    scheduleRefresh(first);
    scheduleRefresh(second);
    expect(seen).toEqual([]);

    configureDomRefreshScheduler((scheduled) => seen.push(scheduled));
    expect(seen).toEqual([first, second]);

    const third = update();
    scheduleRefresh(third);
    expect(seen).toEqual([first, second, third]);
  });
});
