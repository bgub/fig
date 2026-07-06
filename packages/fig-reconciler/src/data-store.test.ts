// These tests intentionally avoid a static @bgub/fig import: roots should
// be able to render and buffer initial data before the package loads, then
// install the real store lazily from the first actual data resource.
import { createElement } from "@bgub/fig";
import type { FigDataResource, FigDataStore } from "@bgub/fig/internal";
import { describe, expect, it } from "vite-plus/test";
import { createRenderer, type HostConfig } from "./index.ts";

class TestText {
  parentNode: TestElement | null = null;

  constructor(public nodeValue: string) {}

  get textContent(): string {
    return this.nodeValue;
  }
}

class TestElement {
  childNodes: Array<TestElement | TestText> = [];
  parentNode: TestElement | null = null;

  constructor(public type: string) {}

  insertBefore(
    node: TestElement | TestText,
    child: TestElement | TestText | null,
  ): void {
    node.parentNode?.removeChild(node);
    const index = child === null ? -1 : this.childNodes.indexOf(child);
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
  }

  removeChild(node: TestElement | TestText): void {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

const host: HostConfig<TestElement, TestElement, TestText> = {
  createInstance: (type) => new TestElement(type),
  createTextInstance: (text) => new TestText(text),
  appendInitialChild: (parent, child) => parent.insertBefore(child, null),
  finalizeInitialInstance: () => undefined,
  insertBefore: (parent, child, before) => parent.insertBefore(child, before),
  removeChild: (parent, child) => parent.removeChild(child),
  commitUpdate: () => undefined,
  commitTextUpdate: (text, value) => {
    text.nodeValue = value;
  },
};

describe("root data store without @bgub/fig", () => {
  it("renders on the stub store and run() executes the callback", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() => root.render(createElement("span", null, "Hello")));

    expect(container.textContent).toBe("Hello");
    expect(root.data.run(() => 42)).toBe(42);
  });

  it("throws a helpful error for data reads before the package loads", () => {
    const { createRoot } = createRenderer(host);
    const root = createRoot(new TestElement("root"));
    const fakeResource = {} as FigDataResource<[], string>;

    expect(() =>
      (root.data as FigDataStore).readData(fakeResource, [], {}),
    ).toThrow("Data resource APIs require @bgub/fig.");
  });

  it("buffers initialData and installs the store from the first data resource", async () => {
    const { createRoot, flushSync } = createRenderer(host);

    // A root disposed before fig-data loads should remain inert.
    const abandoned = createRoot(new TestElement("root"));
    abandoned.unmount();

    const container = new TestElement("root");
    const root = createRoot(container, {
      initialData: [{ key: ["greeting"], value: "Hi from the server" }],
    });
    flushSync(() => root.render(createElement("span", null, "static")));

    const { dataResource, readData } = await import("@bgub/fig");
    const greeting = dataResource<[], string>({
      key: () => ["greeting"],
    });

    function Greeting() {
      return createElement("span", null, readData(greeting));
    }

    flushSync(() => root.render(createElement(Greeting, null)));
    expect(container.textContent).toBe("Hi from the server");

    // Post-upgrade, handle methods delegate to the real store.
    root.data.hydrate([{ key: ["late"], value: "late" }]);
    const late = dataResource<[], string>({ key: () => ["late"] });
    function Late() {
      return createElement("span", null, readData(late));
    }
    flushSync(() => root.render(createElement(Late, null)));
    expect(container.textContent).toBe("late");

    root.data.invalidateDataPrefix(["late"]);
    expect(
      (root.data as FigDataStore)
        .inspectDataEntries()
        .find((entry) => entry.canonicalKey === '["late"]')?.stale,
    ).toBe(true);
  });
});
