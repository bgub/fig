// @vitest-environment happy-dom
import {
  createElement,
  dataResource,
  type DataResource,
  readData,
} from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { createStartDataContext } from "./data.ts";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
});

describe("createStartDataContext", () => {
  it("hands loader entries to the render root and delegates future mutations", async () => {
    let loads = 0;
    const resource = dataResource<[string], string>({
      key: (id: string) => ["start-data", id],
      load: async (id: string) => {
        loads += 1;
        return `${id}-v${loads}`;
      },
    });
    const start = createStartDataContext();

    await expect(start.context.data.ensureData(resource, "one")).resolves.toBe(
      "one-v1",
    );
    const container = document.createElement("div");
    const root = createRoot(container, { dataStore: start.context.data });
    roots.push(root);

    await act(() =>
      root.render(
        createElement("span", null, readDataInComponent(resource, "one")),
      ),
    );

    expect(container.textContent).toBe("one-v1");
    expect(loads).toBe(1);

    await act(() => start.context.data.invalidateData(resource, "one"));

    expect(container.textContent).toBe("one-v2");
    expect(loads).toBe(2);
  });
});

function readDataInComponent(
  resource: DataResource<[string], string>,
  id: string,
) {
  function Value() {
    return readData(resource, id);
  }
  return createElement(Value);
}
