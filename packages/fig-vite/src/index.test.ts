import { describe, expect, it } from "vitest";
import { defaultClientConditions, defaultServerConditions } from "vite";
import type { ConfigEnv, Plugin } from "vite";
import * as figVite from "./index.ts";

const { fig, figRefresh } = figVite;
const serveEnvironment: ConfigEnv = { command: "serve", mode: "development" };
const buildEnvironment: ConfigEnv = { command: "build", mode: "production" };

function requireFunction<T extends (...args: never[]) => unknown>(
  hook: T | { handler: T } | undefined,
): T {
  if (typeof hook === "function") return hook;
  if (hook !== undefined) return hook.handler;
  throw new Error("Expected a function plugin hook.");
}

function configHooks(plugin: Plugin) {
  return {
    config: requireFunction(plugin.config),
    environment: requireFunction(plugin.configEnvironment),
  };
}

describe("@bgub/fig-vite plugin", () => {
  it("exposes the complete integration and the focused refresh plugin", () => {
    expect(Object.keys(figVite)).toEqual(["fig", "figRefresh"]);
  });

  it("sets the Fig development gate from the Vite command", async () => {
    const [plugin] = fig();
    const hooks = configHooks(plugin);
    const serve = await hooks.config.call({} as never, {}, serveEnvironment);
    const build = await hooks.config.call({} as never, {}, buildEnvironment);

    expect(serve).toEqual({
      define: { __FIG_DEV__: "true" },
      ssr: { noExternal: [/^@bgub\/fig(?:$|[-/])/] },
    });
    expect(
      await hooks.environment.call(
        {} as never,
        "client",
        {
          consumer: "client",
          define: serve?.define,
        },
        serveEnvironment,
      ),
    ).toEqual({
      resolve: {
        conditions: [...defaultClientConditions, "fig-development"],
      },
    });
    expect(
      await hooks.environment.call(
        {} as never,
        "ssr",
        {
          consumer: "server",
          define: serve?.define,
        },
        serveEnvironment,
      ),
    ).toEqual({
      resolve: {
        conditions: [...defaultServerConditions, "fig-development"],
      },
    });
    expect(build).toEqual({
      define: { __FIG_DEV__: "false" },
      ssr: { noExternal: [/^@bgub\/fig(?:$|[-/])/] },
    });
    expect(
      await hooks.environment.call(
        {} as never,
        "client",
        {
          consumer: "client",
          define: build?.define,
        },
        buildEnvironment,
      ),
    ).toBeNull();

    const noExternal = serve?.ssr?.noExternal;
    expect(noExternal).toHaveLength(1);
    if (!Array.isArray(noExternal) || !(noExternal[0] instanceof RegExp)) {
      throw new Error(
        "Expected Fig's SSR exclusion to be a regular expression.",
      );
    }
    expect(noExternal[0].test("@bgub/fig")).toBe(true);
    expect(noExternal[0].test("@bgub/fig-dom/refresh")).toBe(true);
    expect(noExternal[0].test("@bgub/figure")).toBe(false);
  });

  it("preserves an explicit application development gate", async () => {
    const [plugin] = fig();
    const hooks = configHooks(plugin);

    expect(
      await hooks.config.call(
        {} as never,
        { define: { __FIG_DEV__: "true" } },
        buildEnvironment,
      ),
    ).toEqual({ ssr: { noExternal: [/^@bgub\/fig(?:$|[-/])/] } });
    expect(
      await hooks.environment.call(
        {} as never,
        "client",
        { define: { __FIG_DEV__: "true" } },
        buildEnvironment,
      ),
    ).toEqual({
      resolve: {
        conditions: [...defaultClientConditions, "fig-development"],
      },
    });

    await hooks.config.call(
      {} as never,
      { define: { __FIG_DEV__: "false" } },
      serveEnvironment,
    );
    expect(
      await hooks.environment.call(
        {} as never,
        "client",
        { define: { __FIG_DEV__: "false" } },
        serveEnvironment,
      ),
    ).toBeNull();
  });

  it("uses browser conditions for worker SSR environments", async () => {
    const [plugin] = fig();
    const hooks = configHooks(plugin);

    expect(
      await hooks.environment.call(
        {} as never,
        "ssr",
        { consumer: "server", define: { __FIG_DEV__: "true" } },
        { ...serveEnvironment, isSsrTargetWebworker: true },
      ),
    ).toEqual({
      resolve: {
        conditions: [...defaultClientConditions, "fig-development"],
      },
    });
  });

  it("rejects a development gate that cannot select a package artifact", () => {
    const [plugin] = fig();
    const hooks = configHooks(plugin);

    expect(() =>
      hooks.environment.call(
        {} as never,
        "client",
        { define: { __FIG_DEV__: "customDevelopmentGate" } },
        serveEnvironment,
      ),
    ).toThrow("must be the static value true or false");
  });

  it("connects the file-loaded runtime to the app's DOM adapter", () => {
    const [, plugin] = fig();
    const id = requireFunction(plugin.resolveId).call(
      {} as never,
      "virtual:fig-refresh",
      undefined,
      {} as never,
    );
    const code =
      typeof id !== "string"
        ? null
        : requireFunction(plugin.load).call({} as never, id);

    expect(code).toContain('from "/@fs/');
    expect(code).toContain("fig-refresh");
    expect(code).toContain(
      'import { domRefreshAdapter } from "@bgub/fig-dom/refresh"',
    );
    expect(code).toContain("injectRenderer(domRefreshAdapter)");
  });

  it("skips refresh transforms during SSR evaluation", async () => {
    const plugin = figRefresh();
    const transform = requireFunction(plugin.transform).bind({
      environment: { config: {} },
    } as never);
    const source = `export function Counter() {
  return <div />;
}`;

    expect(
      await transform(source, "/app/src/Counter.tsx", {
        moduleType: "js",
        ssr: true,
      }),
    ).toBeNull();
  });

  it("skips refresh transforms when development behavior is disabled", async () => {
    const [, plugin] = fig();
    const transform = requireFunction(plugin.transform).bind({
      environment: { config: { define: { __FIG_DEV__: "false" } } },
    } as never);
    const source = `export function Counter() {
  return <div />;
}`;

    expect(await transform(source, "/app/src/Counter.tsx")).toBeNull();
  });
});
