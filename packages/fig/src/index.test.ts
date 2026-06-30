import { describe, expect, it } from "vite-plus/test";
import {
  clientReference,
  clientReferenceResources,
  createContext,
  createElement,
  createPortalNode,
  ErrorBoundary,
  font,
  Fragment,
  lazy,
  meta,
  modulepreload,
  preload,
  readContext,
  readPromise,
  resources,
  stylesheet,
  title,
  Suspense,
  transition,
  useActionState,
  useCallback,
  useExternalStore,
  useId,
  useLaggedValue,
  useMemo,
  useState,
  useTransition,
} from "./index.ts";
import {
  figResourceKey,
  isContext,
  isErrorBoundary,
  isPortal,
  isResources,
  isSuspense,
  isValidElement,
  resourceDestination,
  resourceFromHostAttributes,
  resourceFromHostProps,
  Resources,
} from "./internal.ts";

describe("@bgub/fig", () => {
  it("creates elements with keys and normalized children", () => {
    const element = createElement("div", { key: "a", id: "root" }, "hello", 1);

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe("div");
    expect(element.key).toBe("a");
    expect(element.props).toEqual({ id: "root", children: ["hello", 1] });
  });

  it("supports fragments as element types", () => {
    const element = createElement(Fragment, null, "child");

    expect(element.type).toBe(Fragment);
    expect(element.props.children).toBe("child");
  });

  it("supports Suspense as a special element type", () => {
    const element = createElement(Suspense, { fallback: "Loading" }, "Loaded");
    const emptyFallback = createElement(Suspense, null, "Loaded");

    expect(isSuspense(Suspense)).toBe(true);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(Suspense);
    expect(element.props).toEqual({
      fallback: "Loading",
      children: "Loaded",
    });
    expect(emptyFallback.props).toEqual({ children: "Loaded" });
  });

  it("supports ErrorBoundary as a special element type", () => {
    const element = createElement(
      ErrorBoundary,
      { fallback: "Crashed" },
      "Loaded",
    );

    expect(isErrorBoundary(ErrorBoundary)).toBe(true);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(ErrorBoundary);
    expect(element.props).toEqual({
      fallback: "Crashed",
      children: "Loaded",
    });
  });

  it("creates lazy component types", () => {
    function Message({ label }: { label: string }) {
      return createElement("span", null, label);
    }

    const LazyMessage = lazy(() => Promise.resolve(Message));
    const element = createElement(LazyMessage, { label: "Ready" });

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(LazyMessage);
    expect(element.props).toEqual({ label: "Ready" });
  });

  it("creates resource wrappers", () => {
    const style = stylesheet("/app.css", { precedence: "app" });
    const element = resources(style, "child");

    expect(isResources(Resources)).toBe(true);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(Resources);
    expect(element.props).toEqual({
      children: "child",
      resources: style,
    });
  });

  it("retains eager asset resources on a client reference", () => {
    const css = stylesheet("/assets/Counter.css");
    const js = preload("/assets/Counter.js", "script");
    const Counter = clientReference({
      id: "./Counter.tsx",
      load: () => Promise.resolve({}),
      resources: [css, js],
    });

    expect(Counter.id).toBe("./Counter.tsx");
    expect(clientReferenceResources(Counter)).toEqual([css, js]);
  });

  it("normalizes a single client-reference resource to a list", () => {
    const css = stylesheet("/assets/Counter.css");
    const Counter = clientReference({
      id: "./Counter.tsx",
      load: () => Promise.resolve({}),
      resources: css,
    });

    expect(clientReferenceResources(Counter)).toEqual([css]);
  });

  it("resolves lazy client-reference resources at read time", () => {
    let calls = 0;
    const Counter = clientReference({
      id: "./Counter.tsx",
      load: () => Promise.resolve({}),
      resources: () => {
        calls += 1;
        return [stylesheet(`/assets/Counter.${calls}.css`)];
      },
    });

    // Not resolved until read, then resolved on each call (a manifest may load
    // after the reference is defined).
    expect(calls).toBe(0);
    expect(clientReferenceResources(Counter)).toEqual([
      stylesheet("/assets/Counter.1.css"),
    ]);
    expect(clientReferenceResources(Counter)).toEqual([
      stylesheet("/assets/Counter.2.css"),
    ]);
    expect(calls).toBe(2);
  });

  it("normalizes a lazy resource thunk that yields nothing to an empty list", () => {
    const Counter = clientReference({
      id: "./Counter.tsx",
      load: () => Promise.resolve({}),
      // A missing manifest entry can make a typed thunk return undefined at
      // runtime; the resolver must not leak a non-array.
      resources: () => undefined as never,
    });

    expect(clientReferenceResources(Counter)).toEqual([]);
  });

  it("defaults client-reference resources to an empty list", () => {
    const Counter = clientReference({
      id: "./Counter.tsx",
      load: () => Promise.resolve({}),
    });

    expect(Counter.resources).toBeUndefined();
    expect(clientReferenceResources(Counter)).toEqual([]);
  });

  it("keys a font in the shared preload-font space", () => {
    // A font is loaded as <link rel="preload" as="font">, so it must key
    // identically to an equivalent preload across every package.
    expect(figResourceKey(font("/a.woff2", "font/woff2"))).toBe(
      "preload:font:/a.woff2",
    );
    expect(figResourceKey(preload("/a.woff2", "font"))).toBe(
      "preload:font:/a.woff2",
    );
  });

  it("keys modulepreloads separately from classic script preloads", () => {
    expect(figResourceKey(modulepreload("/chunk.js"))).toBe(
      "modulepreload:/chunk.js",
    );
    expect(figResourceKey(preload("/chunk.js", "script"))).toBe(
      "preload:script:/chunk.js",
    );
  });

  it("collapses every title to the singleton key, ignoring an explicit key", () => {
    expect(figResourceKey(title("A"))).toBe("title");
    expect(figResourceKey(title("B", "explicit"))).toBe("title");
    // Other kinds still honor an explicit key.
    expect(figResourceKey(meta({ name: "robots", key: "r" }))).toBe("meta:r");
  });

  it("classifies resource destinations", () => {
    expect(resourceDestination(title("Fig"))).toBe("head");
    expect(resourceDestination(stylesheet("/app.css"))).toBe("stream");
    expect(resourceDestination(modulepreload("/chunk.js"))).toBe("stream");
  });

  it("lowers host resource props", () => {
    expect(
      resourceFromHostProps("link", {
        href: "/app.css",
        precedence: "app",
        rel: "stylesheet",
      }),
    ).toEqual({
      href: "/app.css",
      kind: "stylesheet",
      precedence: "app",
    });
    expect(
      resourceFromHostProps("title", { children: ["Fig", " ", 1] }),
    ).toEqual({ kind: "title", value: "Fig 1" });
    expect(
      resourceFromHostProps("link", {
        fetchPriority: "high",
        href: "/chunk.js",
        rel: "modulepreload",
      }),
    ).toEqual({
      fetchPriority: "high",
      href: "/chunk.js",
      kind: "modulepreload",
    });
  });

  it("reads host resources from attributes", () => {
    const attributes = new Map([
      ["rel", "stylesheet"],
      ["href", "/app.css"],
    ]);

    expect(
      resourceFromHostAttributes("link", (name) => attributes.get(name)),
    ).toEqual({ href: "/app.css", kind: "stylesheet" });
  });

  it("creates portal nodes", () => {
    const target = {};
    const portal = createPortalNode("child", target, "modal");

    expect(isPortal(portal)).toBe(true);
    expect(portal.children).toBe("child");
    expect(portal.key).toBe("modal");
    expect(portal.target).toBe(target);
  });

  it("creates callable contexts", () => {
    const Theme = createContext("light");
    const element = createElement(Theme, { value: "dark" }, "child");

    expect(isContext(Theme)).toBe(true);
    expect(Theme.defaultValue).toBe("light");
    expect(element.type).toBe(Theme);
    expect(element.props).toEqual({ value: "dark", children: "child" });
  });

  it("throws when hooks are called outside render", () => {
    expect(() => useState(0)).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useActionState((state: number) => state, 0)).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useMemo(() => 1, [])).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useCallback(() => undefined, [])).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useId()).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useLaggedValue("value")).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() => useTransition()).toThrow(
      "Hooks can only be called while rendering a component.",
    );
    expect(() =>
      useExternalStore(
        () => () => undefined,
        () => "snapshot",
      ),
    ).toThrow("Hooks can only be called while rendering a component.");
  });

  it("throws when read APIs are called outside render", () => {
    const Theme = createContext("light");

    expect(() => readContext(Theme)).toThrow(
      "readContext can only be called while rendering a component.",
    );
    expect(() => readPromise(Promise.resolve("done"))).toThrow(
      "readPromise can only be called while rendering a component.",
    );
  });

  it("runs transition callbacks without a renderer", () => {
    expect(transition(() => "done")).toBe("done");
  });
});
