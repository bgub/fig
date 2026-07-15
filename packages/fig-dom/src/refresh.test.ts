import {
  clientReference,
  createElement,
  type FigNode,
  useState,
} from "@bgub/fig";
import {
  createPayloadClientReferenceResolver,
  decodePayloadStream,
} from "@bgub/fig/payload";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { setRefreshHandler } from "@bgub/fig-reconciler/refresh";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { type RefreshFamily, scheduleRefresh } from "./refresh.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

afterEach(() => {
  // Refresh handler is module-global; reset between tests.
  setRefreshHandler(null);
});

// Build a handler that maps a fixed set of component versions to one family.
function familyOf(...types: unknown[]): RefreshFamily {
  const family: RefreshFamily = { current: types[0] };
  setRefreshHandler((type: unknown) =>
    types.includes(type) ? family : undefined,
  );
  return family;
}

function mount(node: FigNode): FakeElement {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(node));
  return container;
}

describe("@bgub/fig-dom fast refresh", () => {
  it("re-renders an updated component in place, preserving hook state", () => {
    let setCount: (next: number) => void = () => undefined;

    function CounterV1(): FigNode {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("div", null, `v1:${count}`);
    }
    function CounterV2(): FigNode {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("div", null, `v2:${count}`);
    }

    const family = familyOf(CounterV1, CounterV2);
    const container = mount(createElement(CounterV1, {}));
    expect(container.textContent).toBe("v1:0");

    flushSync(() => setCount(5));
    expect(container.textContent).toBe("v1:5");

    // Simulate a hot edit: same hooks, new body.
    family.current = CounterV2;
    scheduleRefresh({
      staleFamilies: new Set(),
      updatedFamilies: new Set([family]),
    });

    // New markup, preserved state.
    expect(container.textContent).toBe("v2:5");
  });

  it("remounts a stale component (changed hook signature), resetting state", () => {
    let setLabel: (next: string) => void = () => undefined;

    function OneHook(): FigNode {
      const [label, set] = useState("x");
      setLabel = set;
      return createElement("div", null, `one:${label}`);
    }
    function TwoHooks(): FigNode {
      const [label, set] = useState("x");
      useState(0); // extra hook → signature changed
      setLabel = set;
      return createElement("div", null, `two:${label}`);
    }

    const family = familyOf(OneHook, TwoHooks);
    const container = mount(createElement(OneHook, {}));

    flushSync(() => setLabel("y"));
    expect(container.textContent).toBe("one:y");

    family.current = TwoHooks;
    scheduleRefresh({
      staleFamilies: new Set([family]),
      updatedFamilies: new Set(),
    });

    // Remounted: new body, state back to its initial value.
    expect(container.textContent).toBe("two:x");
  });

  it("updates a nested component while preserving the parent's state", () => {
    let bumpParent: (next: number) => void = () => undefined;

    function ChildV1(): FigNode {
      return createElement("span", null, "child-v1");
    }
    function ChildV2(): FigNode {
      return createElement("span", null, "child-v2");
    }
    const childFamily = familyOf(ChildV1, ChildV2);

    function Parent(): FigNode {
      const [n, set] = useState(0);
      bumpParent = set;
      return createElement(
        "div",
        null,
        createElement("span", null, `parent:${n} `),
        createElement(childFamily.current as typeof ChildV1, {}),
      );
    }

    const container = mount(createElement(Parent, {}));
    expect(container.textContent).toBe("parent:0 child-v1");

    flushSync(() => bumpParent(3));
    expect(container.textContent).toBe("parent:3 child-v1");

    childFamily.current = ChildV2;
    scheduleRefresh({
      staleFamilies: new Set(),
      updatedFamilies: new Set([childFamily]),
    });

    expect(container.textContent).toBe("parent:3 child-v2");
  });

  it("hot-updates a client reference latched by a stateful resolver", async () => {
    // A stateful resolver latches the first resolution per reference id for
    // its own lifetime. That latch must not defeat fast refresh: the family
    // remap resolves the latched function to its newest version at render,
    // and updates a bundler cannot accept escalate to a full reload (which
    // resets the resolver with the page) — so the resolver needs no manual
    // invalidation under the accept-or-reload HMR contract.
    let setCount: (next: number) => void = () => undefined;

    function IslandV1(): FigNode {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("div", null, `v1:${count}`);
    }
    function IslandV2(): FigNode {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("div", null, `v2:${count}`);
    }

    const Island = clientReference<Record<string, never>>({
      id: "app/Island.tsx#Island",
    });
    const family = familyOf(IslandV1, IslandV2);
    const resolver = createPayloadClientReferenceResolver(() => IslandV1);
    const result = renderToPayloadStream(createElement(Island, {}));
    const decode = decodePayloadStream(result.stream, {
      resolveClientReference: resolver,
    });

    const container = mount((await decode) as FigNode);
    expect(container.textContent).toBe("v1:0");
    flushSync(() => setCount(5));
    expect(container.textContent).toBe("v1:5");

    // A hot island edit: the cached wrapper still holds IslandV1, but the
    // family renders the new version in place with hook state preserved.
    family.current = IslandV2;
    scheduleRefresh({
      staleFamilies: new Set(),
      updatedFamilies: new Set([family]),
    });
    expect(container.textContent).toBe("v2:5");
  });

  it("is a no-op when no refresh handler is installed", () => {
    setRefreshHandler(null);
    expect(() =>
      scheduleRefresh({
        staleFamilies: new Set(),
        updatedFamilies: new Set(),
      }),
    ).not.toThrow();
  });
});
