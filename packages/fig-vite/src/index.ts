import { fileURLToPath } from "node:url";
import { transformModule } from "./transform.ts";

const VIRTUAL_ID = "virtual:fig-refresh";
const RESOLVED_VIRTUAL_ID = "\0virtual:fig-refresh";
const REFRESH_RUNTIME_IMPORT = viteFileImport(
  import.meta.resolve("@bgub/fig-refresh"),
);
// A bare specifier so the app's resolve config (aliases, dedupe, prebundling)
// applies; a file path would load a second copy of the scheduler state next to
// the one `@bgub/fig-dom` wires up internally.
const DOM_REFRESH_IMPORT = "@bgub/fig-dom/refresh";

export interface FigRefreshOptions {
  // Files to consider for the refresh transform. Defaults to JS/TS(X).
  include?: RegExp;
}

// Minimal structural shape of a Vite plugin (avoids a hard dep on vite types).
export interface FigRefreshPlugin {
  apply: "serve";
  enforce: "pre";
  load(id: string): string | null;
  name: string;
  resolveId(id: string): string | null;
  transform(
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ): Promise<{ code: string; map: unknown } | null>;
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

      const clean = id.split("?")[0] ?? id;
      if (clean.includes("/node_modules/") || !include.test(clean)) return null;
      return transformModule(code, clean);
    },
  };
}

// The virtual runtime module: wires the renderer to the refresh runtime once,
// and exposes register/setSignature plus a microtask-batched refresh trigger.
function virtualModuleCode(): string {
  return `import { injectScheduleRefresh, performRefresh, register, setSignature } from ${JSON.stringify(
    REFRESH_RUNTIME_IMPORT,
  )};
import { scheduleRefresh } from ${JSON.stringify(DOM_REFRESH_IMPORT)};

injectScheduleRefresh(scheduleRefresh);

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

export { type FigDataPlugin, figData } from "./data/index.ts";
