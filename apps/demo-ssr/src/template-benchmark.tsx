import { createElement, type FigNode } from "@bgub/fig";
import { createRoot, flushSync } from "@bgub/fig-dom";

export interface TemplateBrowserBenchmarkComparison {
  fibersMs: number;
  speedup: number;
  templatesMs: number;
}

export interface TemplateBrowserBenchmarkResult {
  mount: TemplateBrowserBenchmarkComparison;
  reorder: TemplateBrowserBenchmarkComparison;
  rows: number;
  samples: number;
  update: TemplateBrowserBenchmarkComparison;
}

type RenderKind = "fibers" | "templates";

const updateIterations = 10;

export function installTemplateBrowserBenchmark(): void {
  window.__figRunTemplateBenchmark = runTemplateBrowserBenchmark;
}

async function runTemplateBrowserBenchmark(
  rows = 1_000,
  samples = 15,
): Promise<TemplateBrowserBenchmarkResult> {
  for (let index = 0; index < 3; index += 1) {
    measureMount("fibers", Math.min(rows, 200));
    measureMount("templates", Math.min(rows, 200));
  }
  await nextFrame();

  const mount = compare(samples, (kind) => measureMount(kind, rows));
  await nextFrame();
  const update = compare(samples, (kind) => measureUpdate(kind, rows));
  await nextFrame();
  const reorder = compare(samples, (kind) => measureReorder(kind, rows));

  return { mount, reorder, rows, samples, update };
}

function compare(
  samples: number,
  measure: (kind: RenderKind) => number,
): TemplateBrowserBenchmarkComparison {
  const fibers: number[] = [];
  const templates: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const first: RenderKind = index % 2 === 0 ? "fibers" : "templates";
    const second: RenderKind = first === "fibers" ? "templates" : "fibers";
    for (const kind of [first, second]) {
      (kind === "fibers" ? fibers : templates).push(measure(kind));
    }
  }
  const fibersMs = median(fibers);
  const templatesMs = median(templates);
  return { fibersMs, speedup: fibersMs / templatesMs, templatesMs };
}

function measureMount(kind: RenderKind, rows: number): number {
  const { container, root } = benchmarkRoot();
  const start = performance.now();
  flushSync(() => root.render(renderRows(kind, rows, 1, false)));
  const elapsed = performance.now() - start;
  cleanupBenchmarkRoot(container, root);
  return elapsed;
}

function measureUpdate(kind: RenderKind, rows: number): number {
  const { container, root } = benchmarkRoot();
  flushSync(() => root.render(renderRows(kind, rows, 1, false)));
  const start = performance.now();
  for (let index = 0; index < updateIterations; index += 1) {
    flushSync(() => root.render(renderRows(kind, rows, index + 2, false)));
  }
  const elapsed = (performance.now() - start) / updateIterations;
  cleanupBenchmarkRoot(container, root);
  return elapsed;
}

function measureReorder(kind: RenderKind, rows: number): number {
  const { container, root } = benchmarkRoot();
  flushSync(() => root.render(renderRows(kind, rows, 1, false)));
  const start = performance.now();
  for (let index = 0; index < updateIterations; index += 1) {
    flushSync(() => root.render(renderRows(kind, rows, 1, index % 2 === 0)));
  }
  const elapsed = (performance.now() - start) / updateIterations;
  cleanupBenchmarkRoot(container, root);
  return elapsed;
}

function renderRows(
  kind: RenderKind,
  count: number,
  version: number,
  reverse: boolean,
) {
  const Component = kind === "templates" ? CompiledTemplateRows : FiberRows;
  return createElement(Component, { count, reverse, version });
}

// figTemplates() compiles the keyed <li> below into the same descriptor shape
// used by application code. FiberRows authors the identical DOM through
// createElement calls, which the JSX transform cannot template-optimize.
function CompiledTemplateRows({
  count,
  reverse,
  version,
}: {
  count: number;
  reverse: boolean;
  version: number;
}): FigNode {
  const ids = Array.from({ length: count }, (_, index) => index);
  if (reverse) ids.reverse();
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <span>{`Row ${id}`}</span>
          <span>{`v${version}`}</span>
        </li>
      ))}
    </ul>
  );
}

function FiberRows({
  count,
  reverse,
  version,
}: {
  count: number;
  reverse: boolean;
  version: number;
}): FigNode {
  const ids = Array.from({ length: count }, (_, index) => index);
  if (reverse) ids.reverse();
  return createElement(
    "ul",
    null,
    ids.map((id) =>
      createElement(
        "li",
        { key: id },
        createElement("span", null, `Row ${id}`),
        createElement("span", null, `v${version}`),
      ),
    ),
  );
}

function benchmarkRoot() {
  const container = document.createElement("div");
  container.hidden = true;
  document.body.append(container);
  return { container, root: createRoot(container, { devtools: false }) };
}

function cleanupBenchmarkRoot(
  container: HTMLElement,
  root: ReturnType<typeof createRoot>,
): void {
  flushSync(() => root.unmount());
  container.remove();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

declare global {
  interface Window {
    __figRunTemplateBenchmark?: (
      rows?: number,
      samples?: number,
    ) => Promise<TemplateBrowserBenchmarkResult>;
  }
}
