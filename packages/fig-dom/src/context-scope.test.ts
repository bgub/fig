import {
  Activity,
  createContext,
  createElement,
  ErrorBoundary,
  readContext,
  readPromise,
  Suspense,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { createRoot, flushSync, type FigRoot } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

function setup() {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  return { container, root };
}

it("shadows one changed context while carrying another through stable wrappers", () => {
  const Theme = createContext("light");
  const Locale = createContext("en");
  let wrapperRenders = 0;
  function Label() {
    return createElement(
      "span",
      null,
      `${readContext(Theme)}:${readContext(Locale)}`,
    );
  }
  function Wrapper() {
    wrapperRenders++;
    return createElement("section", null, createElement(Label));
  }
  const inner = createElement(
    Theme,
    { value: "fixed" },
    createElement(Wrapper),
  );
  const { container, root } = setup();
  function render(theme: string, locale: string) {
    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: theme },
          createElement(Locale, { value: locale }, inner),
        ),
      ),
    );
  }
  render("light", "en");
  const mountedRenders = wrapperRenders;
  render("dark", "fr");
  expect(container.textContent).toBe("fixed:fr");
  expect(wrapperRenders).toBe(mountedRenders);
  render("light", "de");
  expect(container.textContent).toBe("fixed:de");
  expect(wrapperRenders).toBe(mountedRenders);
});

it("restores outer context changes after an inner provider suspends", async () => {
  const Theme = createContext("default");
  const gate = deferred<string>();
  function Label() {
    return createElement("span", null, readContext(Theme));
  }
  function Blocker({ blocked }: { blocked: boolean }) {
    if (blocked) readPromise(gate.promise);
    return null;
  }
  const laterSibling = createElement(
    "section",
    null,
    createElement("div", null, createElement(Label)),
  );
  const { container, root } = setup();
  function render(value: string, blocked: boolean) {
    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value },
          createElement(
            Suspense,
            { fallback: createElement("i", null, "waiting") },
            createElement(
              Theme,
              { value: "inner" },
              createElement(Blocker, { blocked }),
            ),
          ),
          laterSibling,
        ),
      ),
    );
  }
  render("old", false);
  render("new", true);
  expect(container.textContent).toBe("waitingnew");
  gate.resolve("ready");
  await waitForHostTurns();
  expect(container.textContent).toBe("new");
  render("last", false);
  expect(container.textContent).toBe("last");
});

it("keeps context current through a hidden Activity and its reveal", () => {
  const Theme = createContext("default");
  function Label() {
    return createElement("span", null, readContext(Theme));
  }
  const content = createElement("section", null, createElement(Label));
  const { container, root } = setup();
  function render(value: string, mode: "visible" | "hidden") {
    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value },
          createElement(Activity, { mode }, content),
        ),
      ),
    );
  }
  render("old", "visible");
  render("old", "hidden");
  render("new", "hidden");
  render("new", "visible");
  expect(container.textContent).toBe("new");
  expect((container.childNodes[0] as FakeElement).style.display).not.toBe(
    "none",
  );
});

it.each(["fallback", "primary"])(
  "unwinds nested suspension when %s resolves first",
  async (first) => {
    const Theme = createContext("default");
    const page = deferred<string>();
    const fallback = deferred<string>();
    function Label() {
      return createElement("span", null, readContext(Theme));
    }
    function Page() {
      readPromise(page.promise);
      return createElement(Label);
    }
    function Loading() {
      readPromise(fallback.promise);
      return createElement(Label);
    }
    const { container, root } = setup();
    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "outer" },
          createElement(
            Suspense,
            { fallback: createElement(Label) },
            createElement(
              Theme,
              { value: "middle" },
              createElement(
                Suspense,
                { fallback: createElement(Loading) },
                createElement(Theme, { value: "inner" }, createElement(Page)),
              ),
            ),
          ),
          createElement(Label),
        ),
      ),
    );
    expect(container.textContent).toBe("outerouter");
    if (first === "fallback") {
      fallback.resolve("ready");
      await waitForHostTurns();
      expect(container.textContent).toBe("middleouter");
      page.resolve("ready");
    } else {
      page.resolve("ready");
      await waitForHostTurns();
      expect(container.textContent).toBe("innerouter");
      fallback.resolve("ready");
    }
    await waitForHostTurns();
    expect(container.textContent).toBe("innerouter");
  },
);

it("unwinds providers past an error fallback and an unrelated Suspense handler", () => {
  const Theme = createContext("default");
  const reports: unknown[] = [];
  const failure = new Error("fallback failed");
  function Label() {
    return createElement("span", null, readContext(Theme));
  }
  function Broken(): never {
    throw new Error("primary failed");
  }
  function BrokenFallback(): never {
    expect(readContext(Theme)).toBe("middle");
    throw failure;
  }
  const { container, root } = setup();
  flushSync(() =>
    root.render(
      createElement(
        Theme,
        { value: "outer" },
        createElement(
          ErrorBoundary,
          {
            fallback: createElement(Label),
            onError(error) {
              reports.push(error);
            },
          },
          createElement(
            Suspense,
            { fallback: "wrong handler" },
            createElement(
              Theme,
              { value: "middle" },
              createElement(
                ErrorBoundary,
                { fallback: createElement(BrokenFallback) },
                createElement(Theme, { value: "inner" }, createElement(Broken)),
              ),
            ),
          ),
        ),
        createElement(Label),
      ),
    ),
  );
  expect(container.textContent).toBe("outerouter");
  expect(reports).toEqual([failure]);
});
