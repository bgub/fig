import { type TransformResult, transformModule } from "./transform.ts";

const VIRTUAL_ID = "virtual:fig-refresh";
const RESOLVED_VIRTUAL_ID = "\0virtual:fig-refresh";

export interface FigRefreshOptions {
  // Files to consider for the refresh transform. Defaults to JS/TS(X).
  include?: RegExp;
}

// Minimal structural shape of a Vite plugin (avoids a hard dep on vite types).
export interface FigVitePlugin {
  apply: "serve";
  enforce: "pre";
  load(id: string): string | null;
  name: string;
  resolveId(id: string): string | null;
  transform(code: string, id: string): Promise<TransformResult | null>;
}

export function figRefresh(options: FigRefreshOptions = {}): FigVitePlugin {
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
    async transform(code, id) {
      const clean = id.split("?")[0] ?? id;
      if (clean.includes("/node_modules/") || !include.test(clean)) return null;
      return transformModule(code, clean);
    },
  };
}

// The virtual runtime module: wires the renderer to the refresh runtime once,
// and exposes register/setSignature plus a microtask-batched refresh trigger.
function virtualModuleCode(): string {
  return `import { injectScheduleRefresh, performRefresh, register, setSignature } from "@bgub/fig-refresh";
import { scheduleRefresh } from "@bgub/fig-dom/refresh";

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

export {
  type FigDataPlugin,
  type FigDataPluginOptions,
  figData,
} from "./data/index.ts";
export type {
  ClientDataResourceStub,
  ServerDataClientStubResult,
  ServerDataResourceRef,
} from "./data/transform.ts";
export {
  assertNoServerDataResourceImport,
  collectServerDataResourceStubs,
  dataResourceId,
  discoverServerDataResources,
  rootRelative,
  transformServerDataClientStub,
} from "./data/transform.ts";
export { transformModule };
