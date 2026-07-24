import { fileURLToPath } from "node:url";
import { defaultClientConditions, defaultServerConditions } from "vite";
import type { Plugin } from "vite";
import { transformDevGate, transformModule } from "./transform.ts";

const VIRTUAL_ID = "virtual:fig-refresh";
const RESOLVED_VIRTUAL_ID = "\0virtual:fig-refresh";
const DEVELOPMENT_CONDITION = "fig-development";
const FIG_PACKAGE_PATTERN = /^@bgub\/fig(?:$|[-/])/;
const REFRESH_RUNTIME_IMPORT = viteFileImport(
  import.meta.resolve("@bgub/fig-refresh"),
);
// Resolve the adapter from the app graph so it owns the same DOM renderer and
// reconciler as the application.
const DOM_REFRESH_IMPORT = "@bgub/fig-dom/refresh";

export interface FigRefreshOptions {
  // Files to consider for the refresh transform. Defaults to JS/TS(X).
  include?: RegExp;
}

// Kept as a named alias for compatibility with the original public surface.
export type FigRefreshPlugin = Plugin;

export function fig(
  options: FigRefreshOptions = {},
): [Plugin, FigRefreshPlugin] {
  return [figConfig(), figRefresh(options)];
}

function figConfig(): Plugin {
  return {
    name: "fig:config",
    config(config, environment) {
      return {
        ...(config.define?.__FIG_DEV__ === undefined
          ? {
              define: {
                __FIG_DEV__: JSON.stringify(environment.command === "serve"),
              },
            }
          : {}),
        // Fig's renderer, server, and framework adapters share ambient state.
        // Keeping sibling packages in one SSR graph prevents an SSR packager
        // from splitting that state across independently evaluated modules.
        ssr: { noExternal: [FIG_PACKAGE_PATTERN] },
      };
    },
    configEnvironment(name, config, environment) {
      if (!developmentGate(config.define?.__FIG_DEV__)) return null;

      const clientEnvironment =
        environment.isSsrTargetWebworker === true ||
        (config.consumer ?? (name === "client" ? "client" : "server")) ===
          "client";
      const defaults = clientEnvironment
        ? defaultClientConditions
        : defaultServerConditions;
      return {
        resolve: {
          conditions: [
            ...new Set([
              ...(config.resolve?.conditions ?? defaults),
              DEVELOPMENT_CONDITION,
            ]),
          ],
        },
      };
    },
    async transform(code, id) {
      const gate = this.environment.config.define?.__FIG_DEV__;
      if (gate === undefined || !code.includes("__FIG_DEV__")) return null;

      return transformDevGate(code, id, developmentGate(gate));
    },
  };
}

function developmentGate(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(
    "Fig's __FIG_DEV__ definition must be the static value true or false.",
  );
}

export function figRefresh(options: FigRefreshOptions = {}): FigRefreshPlugin {
  const include = options.include ?? /\.[jt]sx?$/;

  return {
    apply: "serve",
    enforce: "pre",
    name: "fig:refresh",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    load(id) {
      return id === RESOLVED_VIRTUAL_ID ? virtualModuleCode() : null;
    },
    async transform(code, id, transformOptions) {
      if (transformOptions?.ssr === true) return null;
      const gate = this.environment.config.define?.__FIG_DEV__;
      if (gate !== undefined && !developmentGate(gate)) return null;

      const clean = id.split("?")[0] ?? id;
      if (clean.includes("/node_modules/") || !include.test(clean)) return null;
      return transformModule(code, clean);
    },
  };
}

// The virtual runtime module: wires the renderer to the refresh runtime once,
// and exposes register/setSignature plus a microtask-batched refresh trigger.
function virtualModuleCode(): string {
  return `import { injectRenderer, performRefresh, register, setSignature } from ${JSON.stringify(
    REFRESH_RUNTIME_IMPORT,
  )};
import { domRefreshAdapter } from ${JSON.stringify(DOM_REFRESH_IMPORT)};

injectRenderer(domRefreshAdapter);

let queued = false;
export function enqueueRefresh() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    performRefresh();
  });
}

export { register, setSignature };
`;
}

function viteFileImport(url: string): string {
  return `/@fs/${fileURLToPath(url)}`;
}
