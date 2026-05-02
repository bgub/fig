import {
  createContext,
  type FigNode,
  readContext,
  readPromise,
  Suspense,
  transition,
  useBeforePaint,
  useOnMount,
  useReactive,
  useState,
} from "@bgub/fig";
import {
  type Bind,
  createRoot,
  flushSync,
  hydrateRoot,
  on,
} from "@bgub/fig-dom";
import { renderToString } from "@bgub/fig-server";
import { createElement, type ReactNode } from "react";
import { flushSync as reactFlushSync } from "react-dom";
import {
  createRoot as createReactRoot,
  type Root as ReactRoot,
} from "react-dom/client";

type Page =
  | "state"
  | "diffing"
  | "effects"
  | "async"
  | "resources"
  | "hydration"
  | "benchmarks";

interface DemoItem {
  id: number;
  label: string;
  tone: string;
}

interface BenchmarkOperations {
  createInstance: number;
  createTextInstance: number;
  appendChild: number;
  insertBefore: number;
  removeChild: number;
  commitTextUpdate: number;
}

type BenchmarkRuntime = "Fig" | "React";

interface BenchmarkResult {
  runtime: BenchmarkRuntime;
  name: string;
  rows: number;
  iterations: number;
  samples: number[];
  median: number;
  min: number;
  max: number;
  notes: string;
  operations?: BenchmarkOperations;
}

interface BenchmarkComparison {
  name: string;
  rows: number;
  notes: string;
  fig: BenchmarkResult | null;
  react: BenchmarkResult | null;
}

const benchmarkSampleCount = 5;
const benchmarkTargetMs = 40;
const benchmarkMaxIterations = 50;

let activeBenchmarkOperations: BenchmarkOperations | null = null;

const pages: Array<{ id: Page; label: string }> = [
  { id: "state", label: "State + events" },
  { id: "diffing", label: "Keyed diffing" },
  { id: "effects", label: "Effects + bind" },
  { id: "async", label: "Async event signals" },
  { id: "resources", label: "Context + promises" },
  { id: "hydration", label: "SSR + hydration" },
  { id: "benchmarks", label: "Benchmarks" },
];

const initialItems: DemoItem[] = [
  { id: 1, label: "Parse JSX", tone: "core" },
  { id: 2, label: "Build fibers", tone: "render" },
  { id: 3, label: "Commit DOM", tone: "dom" },
];

const ThemeContext = createContext("light");

type HydrationWrapper = "section" | "article";

const hydrationDemo = {
  root: null as ReturnType<typeof createRoot> | null,
  sandbox: null as HTMLDivElement | null,
};

const focusBoundInput: Bind<HTMLInputElement> = (node, signal) => {
  node.focus();
  node.setAttribute("data-bound", "true");
  signal.addEventListener("abort", () => node.removeAttribute("data-bound"), {
    once: true,
  });
};

function PageFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: FigNode;
}) {
  return (
    <section className="page">
      <h2>{title}</h2>
      <p className="lede">{lede}</p>
      <div className="panel stack">{children}</div>
    </section>
  );
}

function Row({ children }: { children: FigNode }) {
  return <div className="row">{children}</div>;
}

function Command({
  children,
  primary,
  run,
}: {
  children: FigNode;
  primary?: boolean;
  run: () => void;
}) {
  return (
    <button
      type="button"
      className={primary ? "button primary" : "button"}
      events={[on("click", run)]}
    >
      {children}
    </button>
  );
}

function App() {
  const [page, setPage] = useState<Page>("hydration");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Fig Demo</h1>
          <p>Small examples for exercising runtime behavior.</p>
        </div>
        <nav className="nav">
          {pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === page ? "active" : ""}
              events={[on("click", () => setPage(item.id))]}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">{pageView(page)}</main>
    </div>
  );
}

function pageView(page: Page) {
  switch (page) {
    case "diffing":
      return <DiffingPage />;
    case "effects":
      return <EffectsPage />;
    case "async":
      return <AsyncPage />;
    case "resources":
      return <ResourcesPage />;
    case "hydration":
      return <HydrationPage />;
    case "benchmarks":
      return <BenchmarksPage />;
    default:
      return <StatePage />;
  }
}

function StatePage() {
  const [count, setCount] = useState(0);
  const [lastAction, setLastAction] = useState("Nothing yet");

  return (
    <PageFrame
      title="State + events"
      lede="Basic state updates, batched DOM event handlers, and delegated events."
    >
      <Row>
        <span className="metric">{count}</span>
        <Command
          primary
          run={() => {
            setCount((value) => value + 1);
            setLastAction("Incremented once");
          }}
        >
          Increment
        </Command>
        <Command
          run={() => {
            setCount((value) => value + 1);
            setCount((value) => value + 1);
            setLastAction("Queued two updates in one event");
          }}
        >
          Double update
        </Command>
        <Command
          run={() => {
            setCount(0);
            setLastAction("Reset");
          }}
        >
          Reset
        </Command>
      </Row>
      <p className="hint">{lastAction}</p>
    </PageFrame>
  );
}

function DiffingPage() {
  const [items, setItems] = useState(() => initialItems);
  const [nextId, setNextId] = useState(4);

  return (
    <PageFrame
      title="Keyed diffing"
      lede="Reorder, insert, and remove keyed children while preserving identity."
    >
      <Row>
        <Command primary run={() => setItems((value) => value.toReversed())}>
          Reverse
        </Command>
        <Command run={() => setItems(rotate)}>Rotate</Command>
        <Command
          run={() => {
            setItems((value) => [...value, newItem(nextId)]);
            setNextId((value) => value + 1);
          }}
        >
          Add
        </Command>
        <Command run={() => setItems((value) => value.slice(0, -1))}>
          Remove last
        </Command>
      </Row>
      <DemoList items={items} />
    </PageFrame>
  );
}

function EffectsPage() {
  const [tick, setTick] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const log = (message: string) => {
    setLogs((value) =>
      [`${new Date().toLocaleTimeString()}  ${message}`, ...value].slice(0, 8),
    );
  };

  useBeforePaint(() => {
    log(`useBeforePaint for tick ${tick}`);
  }, [tick]);

  useOnMount((signal) => {
    log("useOnMount");
    signal.addEventListener(
      "abort",
      () => console.log("Effects page unmounted"),
      {
        once: true,
      },
    );
  });

  useReactive(
    (signal) => {
      log(`useReactive for tick ${tick}`);
      signal.addEventListener(
        "abort",
        () => console.log(`Reactive effect aborted for tick ${tick}`),
        { once: true },
      );
    },
    [tick],
  );

  return (
    <PageFrame
      title="Effects + bind"
      lede="Effect phases use AbortSignal cleanup. The input is focused by bind."
    >
      <Row>
        <input
          className="input"
          bind={focusBoundInput}
          value={`Bound input, tick ${tick}`}
        />
        <Command primary run={() => setTick((value) => value + 1)}>
          Tick effects
        </Command>
      </Row>
      <pre className="log">{logs.join("\n")}</pre>
    </PageFrame>
  );
}

function AsyncPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Type to search");
  const [results, setResults] = useState<string[]>([]);

  return (
    <PageFrame
      title="Async event signals"
      lede="Input events receive AbortSignal cleanup, so stale async work is cancelled on re-entry."
    >
      <input
        className="input"
        value={query}
        placeholder="Try typing quickly"
        events={[
          on("input", (event, signal) => {
            const nextQuery = (event.currentTarget as HTMLInputElement).value;
            setQuery(nextQuery);

            if (nextQuery.trim() === "") {
              setStatus("Type to search");
              setResults([]);
              return;
            }

            setStatus(`Searching for "${nextQuery}"`);
            const timeout = window.setTimeout(() => {
              if (signal.aborted) return;

              setResults(searchResults(nextQuery));
              setStatus(`Latest result for "${nextQuery}"`);
            }, 650);

            signal.addEventListener(
              "abort",
              () => window.clearTimeout(timeout),
              {
                once: true,
              },
            );
          }),
        ]}
      />
      <p className="hint">{status}</p>
      <ResultList results={results} />
    </PageFrame>
  );
}

function ResourcesPage() {
  const [theme, setTheme] = useState("light");
  const [messagePromise, setMessagePromise] = useState<Promise<string> | null>(
    null,
  );

  return (
    <PageFrame
      title="Context + promises"
      lede="Context reads, local fallbacks, and transition retries."
    >
      <ThemeContext value={theme}>
        <Row>
          <ContextBadge />
          <Command
            primary
            run={() =>
              setTheme((value) => (value === "light" ? "dark" : "light"))
            }
          >
            Toggle context
          </Command>
          <Command
            run={() =>
              setMessagePromise(delayedMessage(messageText("Resolved", theme)))
            }
          >
            Read promise
          </Command>
          <Command
            run={() =>
              transition(() => {
                setMessagePromise(
                  delayedMessage(messageText("Transitioned", theme)),
                );
              })
            }
          >
            Transition read
          </Command>
        </Row>
        {messagePromise === null ? (
          <p className="hint">No promise read yet.</p>
        ) : (
          <Suspense fallback={<p className="hint">Loading message...</p>}>
            <PromiseMessage promise={messagePromise} />
          </Suspense>
        )}
      </ThemeContext>
    </PageFrame>
  );
}

function HydrationPage() {
  const [serverHtml, setServerHtml] = useState("");
  const [status, setStatus] = useState("Render server HTML to begin.");
  const [recoverableErrors, setRecoverableErrors] = useState<string[]>([]);

  const runDemo = async (mismatch: boolean, signal?: AbortSignal) => {
    const sandbox = hydrationDemo.sandbox;
    if (sandbox === null) {
      setStatus("Hydration sandbox is not mounted yet.");
      return;
    }

    setStatus("Rendering HTML with @bgub/fig-server...");
    setRecoverableErrors([]);
    resetHydrationDemoRoot();
    sandbox.replaceChildren();

    const { html, servedAt } = await renderHydrationHtml(mismatch);
    if (signal?.aborted === true || hydrationDemo.sandbox !== sandbox) return;

    const target = hydrationTarget(html);
    sandbox.replaceChildren(target);
    setServerHtml(html);
    setStatus(
      mismatch
        ? "Hydrating intentionally mismatched HTML..."
        : "Hydrating matching server HTML...",
    );

    flushSync(() => {
      hydrationDemo.root = hydrateRoot(
        target,
        <HydrationIsland
          mode={mismatch ? "client" : "server"}
          servedAt={servedAt}
          wrapper="section"
          onAction={() => {
            setStatus(
              `Hydrated event handled at ${new Date().toLocaleTimeString()}.`,
            );
          }}
        />,
        {
          onRecoverableError(error) {
            setRecoverableErrors((errors) => [
              ...errors,
              error instanceof Error ? error.message : String(error),
            ]);
            setStatus("Mismatch recovered with a client render.");
          },
        },
      );
    });

    if (!mismatch) setStatus("Hydrated matching server HTML.");
  };

  useOnMount((signal) => {
    void runDemo(false, signal);
  });

  return (
    <PageFrame
      title="SSR + hydration"
      lede="Render HTML with the Fig server renderer, then hydrate it with the DOM renderer."
    >
      <Row>
        <Command primary run={() => void runDemo(false)}>
          Hydrate matching HTML
        </Command>
        <Command run={() => void runDemo(true)}>Recover mismatch</Command>
      </Row>
      <p className="hint">{status}</p>
      {recoverableErrors.length > 0 ? (
        <ul className="list">
          {recoverableErrors.map((message) => (
            <li className="item" key={message}>
              <span>{message}</span>
              <span className="tag">recoverable</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="hydration-grid">
        <section>
          <h3>Server HTML</h3>
          <pre className="code">{serverHtml || "No server render yet."}</pre>
        </section>
        <section>
          <h3>Hydration target</h3>
          <div className="hydration-sandbox" bind={hydrationSandboxBind} />
        </section>
      </div>
    </PageFrame>
  );
}

async function renderHydrationHtml(mismatch: boolean): Promise<{
  html: string;
  servedAt: string;
}> {
  const servedAt = new Date().toLocaleString();
  const html = await renderToString(
    <HydrationIsland
      mode="server"
      servedAt={servedAt}
      wrapper={mismatch ? "article" : "section"}
    />,
  );

  return { html, servedAt };
}

function hydrationTarget(html: string): HTMLDivElement {
  const target = document.createElement("div");
  target.className = "hydration-target";
  target.innerHTML = html;
  return target;
}

function HydrationIsland({
  mode,
  wrapper,
  onAction,
  servedAt,
}: {
  mode: "server" | "client";
  servedAt: string;
  wrapper: HydrationWrapper;
  onAction?: () => void;
}) {
  const content = (
    <>
      <div className="row">
        <span className="metric">SSR</span>
        <span className="tag">{mode}</span>
      </div>
      <p className="hint">
        This subtree was rendered to HTML first, then claimed by hydrateRoot.
      </p>
      <p className="server-stamp">Server-rendered at {servedAt}</p>
      <button
        type="button"
        className="button primary"
        events={[on("click", () => onAction?.())]}
      >
        Test hydrated event
      </button>
    </>
  );

  const Element = wrapper;
  return (
    <Element className="hydration-card" data-mode={mode}>
      {content}
    </Element>
  );
}

const hydrationSandboxBind: Bind<HTMLDivElement> = (node, signal) => {
  hydrationDemo.sandbox = node;
  signal.addEventListener(
    "abort",
    () => {
      hydrationDemo.root = null;
      if (hydrationDemo.sandbox === node) hydrationDemo.sandbox = null;
    },
    { once: true },
  );
};

function resetHydrationDemoRoot(): void {
  const root = hydrationDemo.root;
  if (root === null) return;

  hydrationDemo.root = null;
  flushSync(() => root.unmount());
}

function BenchmarksPage() {
  const [rowCount, setRowCount] = useState(1000);
  const [status, setStatus] = useState("Ready to run.");
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  return (
    <PageFrame
      title="Benchmarks"
      lede="Synchronous render/update microbenchmarks comparing Fig and React on the same DOM workloads."
    >
      <Row>
        <label className="field">
          Rows
          <input
            className="input small"
            type="number"
            min="10"
            max="10000"
            value={rowCount}
            events={[
              on("input", (event) => {
                const value = Number(
                  (event.currentTarget as HTMLInputElement).value,
                );
                if (Number.isFinite(value)) setRowCount(clampRows(value));
              }),
            ]}
          />
        </label>
        <Command
          primary
          run={() => {
            setStatus("Running benchmarks...");
            window.setTimeout(() => {
              const nextResults = runBenchmarks(rowCount);
              setResults(nextResults);
              setStatus(
                `Completed ${nextResults.length} scenarios at ${new Date().toLocaleTimeString()}.`,
              );
            }, 0);
          }}
        >
          Run benchmarks
        </Command>
        <Command
          run={() => {
            setResults([]);
            setStatus("Ready to run.");
          }}
        >
          Clear
        </Command>
      </Row>
      <p className="hint">{status}</p>
      {results.length === 0 ? (
        <p className="hint">
          Results measure median synchronous `flushSync` time across five
          batched samples for both Fig and React. Use them for relative
          comparisons, not absolute browser benchmarks.
        </p>
      ) : (
        <BenchmarkTable results={results} />
      )}
    </PageFrame>
  );
}

function BenchmarkTable({ results }: { results: BenchmarkResult[] }) {
  const comparisons = benchmarkComparisons(results);

  return (
    <table className="benchmark-table">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Rows</th>
          <th>Fig median</th>
          <th>React median</th>
          <th>Fig vs React</th>
          <th>Ops</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {comparisons.map((comparison) => {
          const max = benchmarkMaxMedian(comparison);

          return (
            <tr key={comparison.name}>
              <td>{comparison.name}</td>
              <td>{comparison.rows}</td>
              <td>
                <BenchmarkMeasure result={comparison.fig} max={max} />
              </td>
              <td>
                <BenchmarkMeasure result={comparison.react} max={max} />
              </td>
              <td>
                <BenchmarkDelta comparison={comparison} />
              </td>
              <td className="ops-cell">
                <BenchmarkOps
                  label="Fig"
                  operations={comparison.fig?.operations}
                />
                <BenchmarkOps
                  label="React"
                  operations={comparison.react?.operations}
                />
              </td>
              <td>{comparison.notes}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BenchmarkMeasure({
  result,
  max,
}: {
  result: BenchmarkResult | null;
  max: number;
}) {
  if (result === null) return <span className="hint">—</span>;

  const width = Math.max(2, (result.median / max) * 100);

  return (
    <div className="benchmark-measure">
      <div className="benchmark-measure-label">
        <span className={`runtime ${result.runtime.toLowerCase()}`}>
          {result.runtime}
        </span>
        <strong>{formatMs(result.median)}</strong>
      </div>
      <div className="benchmark-bar" title="Longer bars are slower.">
        <div
          className={`benchmark-bar-fill ${result.runtime.toLowerCase()}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="benchmark-range">
        {formatMs(result.min)} – {formatMs(result.max)} · ×{result.iterations}
        /sample
      </div>
    </div>
  );
}

function BenchmarkDelta({ comparison }: { comparison: BenchmarkComparison }) {
  const delta = benchmarkDelta(comparison);
  return <span className={`benchmark-delta ${delta.kind}`}>{delta.text}</span>;
}

function BenchmarkOps({
  label,
  operations,
}: {
  label: BenchmarkRuntime;
  operations: BenchmarkOperations | undefined;
}) {
  return (
    <div>
      <strong>{label}</strong> {formatOperations(operations)}
    </div>
  );
}

function ContextBadge() {
  const theme = readContext(ThemeContext);

  return <span className="metric">{theme}</span>;
}

function PromiseMessage({ promise }: { promise: Promise<string> }) {
  return <p className="hint">{readPromise(promise)}</p>;
}

function DemoList({ items }: { items: DemoItem[] }) {
  return (
    <ul className="list">
      {items.map((item) => (
        <li className="item" key={item.id}>
          <span>{item.label}</span>
          <span className="tag">{item.tone}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultList({ results }: { results: string[] }) {
  return (
    <ul className="list">
      {results.map((result) => (
        <li className="item" key={result}>
          <span>{result}</span>
          <span className="tag">fresh</span>
        </li>
      ))}
    </ul>
  );
}

interface BenchmarkRowsProps {
  count: number;
  label?: string;
  reverse?: boolean;
  start?: number;
  version?: number;
}

function BenchmarkRows({
  count,
  label = "Row",
  reverse = false,
  start = 0,
  version = 0,
}: BenchmarkRowsProps) {
  const rows = benchmarkRowIds(count, start, reverse);

  return (
    <ul className="benchmark-list">
      {rows.map((id) => (
        <li className="benchmark-row" key={id}>
          <span>
            {label} {id}
          </span>
          <span className="tag">v{version}</span>
        </li>
      ))}
    </ul>
  );
}

function reactBenchmarkElement(props: BenchmarkRowsProps): ReactNode {
  return createElement(ReactBenchmarkRows, props);
}

function ReactBenchmarkRows({
  count,
  label = "Row",
  reverse = false,
  start = 0,
  version = 0,
}: BenchmarkRowsProps): ReactNode {
  return createElement(
    "ul",
    { className: "benchmark-list" },
    benchmarkRowIds(count, start, reverse).map((id) =>
      createElement(
        "li",
        { className: "benchmark-row", key: id },
        createElement("span", null, `${label} ${id}`),
        createElement("span", { className: "tag" }, `v${version}`),
      ),
    ),
  );
}

function benchmarkRowIds(
  count: number,
  start: number,
  reverse: boolean,
): number[] {
  const rows: number[] = [];
  for (let index = 0; index < count; index += 1) rows.push(start + index);
  if (reverse) rows.reverse();
  return rows;
}

function rotate<T>(items: T[]): T[] {
  return items.length < 2 ? items : [...items.slice(1), items[0]];
}

function newItem(id: number): DemoItem {
  return { id, label: `Demo item ${id}`, tone: "new" };
}

function searchResults(query: string): string[] {
  return [
    `${query} in components`,
    `${query} in effects`,
    `${query} in events`,
  ];
}

function delayedMessage(message: string): Promise<string> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(message), 650);
  });
}

function messageText(kind: string, theme: string): string {
  return `${kind} for ${theme} theme at ${Math.round(performance.now())}`;
}

function runBenchmarks(rowCount: number): BenchmarkResult[] {
  const rows = clampRows(rowCount);
  const appendCount = Math.max(1, Math.round(rows * 0.1));

  return [
    measureBenchmark(
      "Fig",
      "Initial mount",
      rows,
      "Fresh root and host tree creation.",
      (iterations) => measureFigInitialMount(rows, iterations),
    ),
    measureBenchmark(
      "React",
      "Initial mount",
      rows,
      "Fresh root and host tree creation.",
      (iterations) => measureReactInitialMount(rows, iterations),
    ),
    measureBenchmark(
      "Fig",
      "Same-order update",
      rows,
      "Stable keys, changed row props/text.",
      (iterations) =>
        measureFigUpdate(
          <BenchmarkRows count={rows} version={1} />,
          <BenchmarkRows count={rows} version={2} />,
          iterations,
        ),
    ),
    measureBenchmark(
      "React",
      "Same-order update",
      rows,
      "Stable keys, changed row props/text.",
      (iterations) =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows, version: 1 }),
          reactBenchmarkElement({ count: rows, version: 2 }),
          iterations,
        ),
    ),
    measureBenchmark(
      "Fig",
      "Append 10%",
      rows,
      "Stable ordered keys plus new tail rows.",
      (iterations) =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows + appendCount} />,
          iterations,
        ),
    ),
    measureBenchmark(
      "React",
      "Append 10%",
      rows,
      "Stable ordered keys plus new tail rows.",
      (iterations) =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({ count: rows + appendCount }),
          iterations,
        ),
    ),
    measureBenchmark(
      "Fig",
      "Prepend 10%",
      rows,
      "New head rows before stable existing keys.",
      (iterations) =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows + appendCount} start={-appendCount} />,
          iterations,
        ),
    ),
    measureBenchmark(
      "React",
      "Prepend 10%",
      rows,
      "New head rows before stable existing keys.",
      (iterations) =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({
            count: rows + appendCount,
            start: -appendCount,
          }),
          iterations,
        ),
    ),
    measureBenchmark(
      "Fig",
      "Reverse keyed rows",
      rows,
      "Worst-case keyed reordering pressure.",
      (iterations) =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows} reverse />,
          iterations,
        ),
    ),
    measureBenchmark(
      "React",
      "Reverse keyed rows",
      rows,
      "Worst-case keyed reordering pressure.",
      (iterations) =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({ count: rows, reverse: true }),
          iterations,
        ),
    ),
  ];
}

function measureBenchmark(
  runtime: BenchmarkRuntime,
  name: string,
  rows: number,
  notes: string,
  measure: (iterations: number) => number,
): BenchmarkResult {
  const warmup = measure(1);
  const iterations = benchmarkIterations(warmup);
  const samples: number[] = [];

  for (let index = 0; index < benchmarkSampleCount; index += 1) {
    samples.push(measure(iterations) / iterations);
  }

  const operations = createBenchmarkOperations();
  activeBenchmarkOperations = operations;
  try {
    measure(1);
  } finally {
    activeBenchmarkOperations = null;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    runtime,
    name,
    rows,
    iterations,
    samples,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    notes,
    operations: hasOperations(operations) ? operations : undefined,
  };
}

function benchmarkIterations(warmupMs: number): number {
  if (warmupMs <= 0) return benchmarkMaxIterations;
  return Math.min(
    benchmarkMaxIterations,
    Math.max(1, Math.ceil(benchmarkTargetMs / warmupMs)),
  );
}

function createBenchmarkOperations(): BenchmarkOperations {
  return {
    createInstance: 0,
    createTextInstance: 0,
    appendChild: 0,
    insertBefore: 0,
    removeChild: 0,
    commitTextUpdate: 0,
  };
}

function hasOperations(operations: BenchmarkOperations): boolean {
  return Object.values(operations).some((value) => value > 0);
}

function measureFigInitialMount(rows: number, iterations: number): number {
  const roots = createFigBenchmarkRoots(iterations);
  const duration = measureFigSync(() => {
    for (const { root } of roots) {
      root.render(<BenchmarkRows count={rows} version={1} />);
    }
  });
  cleanupFigBenchmarkRoots(roots);
  return duration;
}

function measureReactInitialMount(rows: number, iterations: number): number {
  const roots = createReactBenchmarkRoots(iterations);
  const duration = measureReactSync(() => {
    for (const { root } of roots) {
      root.render(reactBenchmarkElement({ count: rows, version: 1 }));
    }
  });
  cleanupReactBenchmarkRoots(roots);
  return duration;
}

function measureFigUpdate(
  previous: FigNode,
  next: FigNode,
  iterations: number,
): number {
  const roots = createFigBenchmarkRoots(iterations);
  for (const { root } of roots) flushSync(() => root.render(previous));
  const duration = measureFigSync(() => {
    for (const { root } of roots) root.render(next);
  });
  cleanupFigBenchmarkRoots(roots);
  return duration;
}

function measureReactUpdate(
  previous: ReactNode,
  next: ReactNode,
  iterations: number,
): number {
  const roots = createReactBenchmarkRoots(iterations);
  for (const { root } of roots) reactFlushSync(() => root.render(previous));
  const duration = measureReactSync(() => {
    for (const { root } of roots) root.render(next);
  });
  cleanupReactBenchmarkRoots(roots);
  return duration;
}

function measureFigSync(callback: () => void): number {
  return measureSync(() => flushSync(callback));
}

function measureReactSync(callback: () => void): number {
  return measureSync(() => reactFlushSync(callback));
}

function measureSync(callback: () => void): number {
  const operations = activeBenchmarkOperations;

  if (operations !== null) {
    return captureDomOperations(operations, () => {
      const start = performance.now();
      callback();
      return performance.now() - start;
    });
  }

  const start = performance.now();
  callback();
  return performance.now() - start;
}

function captureDomOperations<T>(
  operations: BenchmarkOperations,
  callback: () => T,
): T {
  const createElement = document.createElement.bind(document);
  const createTextNode = document.createTextNode.bind(document);
  const appendChild = Node.prototype.appendChild;
  const insertBefore = Node.prototype.insertBefore;
  const removeChild = Node.prototype.removeChild;
  const nodeValueOwner = propertyDescriptorOwner(Node.prototype, "nodeValue");
  const nodeValueDescriptor =
    nodeValueOwner === null
      ? undefined
      : Object.getOwnPropertyDescriptor(nodeValueOwner, "nodeValue");

  document.createElement = ((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    operations.createInstance += 1;
    return createElement(tagName, options);
  }) as Document["createElement"];
  document.createTextNode = (data: string) => {
    operations.createTextInstance += 1;
    return createTextNode(data);
  };
  Node.prototype.appendChild = function measuredAppendChild<TNode extends Node>(
    this: Node,
    node: TNode,
  ): TNode {
    operations.appendChild += 1;
    return appendChild.call(this, node) as TNode;
  };
  Node.prototype.insertBefore = function measuredInsertBefore<
    TNode extends Node,
  >(this: Node, node: TNode, child: Node | null): TNode {
    operations.insertBefore += 1;
    return insertBefore.call(this, node, child) as TNode;
  };
  Node.prototype.removeChild = function measuredRemoveChild<TNode extends Node>(
    this: Node,
    child: TNode,
  ): TNode {
    operations.removeChild += 1;
    return removeChild.call(this, child) as TNode;
  };

  if (
    nodeValueOwner !== null &&
    nodeValueDescriptor?.get !== undefined &&
    nodeValueDescriptor.set !== undefined &&
    nodeValueDescriptor.configurable
  ) {
    Object.defineProperty(nodeValueOwner, "nodeValue", {
      configurable: true,
      enumerable: nodeValueDescriptor.enumerable,
      get(this: Node) {
        return nodeValueDescriptor.get?.call(this) as string | null;
      },
      set(this: Node, value: string | null) {
        if (this.nodeType === Node.TEXT_NODE) operations.commitTextUpdate += 1;
        nodeValueDescriptor.set?.call(this, value);
      },
    });
  }

  try {
    return callback();
  } finally {
    document.createElement = createElement as Document["createElement"];
    document.createTextNode = createTextNode;
    Node.prototype.appendChild = appendChild;
    Node.prototype.insertBefore = insertBefore;
    Node.prototype.removeChild = removeChild;
    if (nodeValueOwner !== null && nodeValueDescriptor !== undefined) {
      Object.defineProperty(nodeValueOwner, "nodeValue", nodeValueDescriptor);
    }
  }
}

function propertyDescriptorOwner(
  prototype: object | null,
  property: string,
): object | null {
  for (
    let owner = prototype;
    owner !== null;
    owner = Object.getPrototypeOf(owner)
  ) {
    if (Object.hasOwn(owner, property)) return owner;
  }

  return null;
}

function createFigBenchmarkRoots(iterations: number): Array<{
  root: ReturnType<typeof createRoot>;
  container: Node;
}> {
  return Array.from({ length: iterations }, () => {
    const container = createBenchmarkContainer();
    return { root: createRoot(container), container };
  });
}

function createReactBenchmarkRoots(iterations: number): Array<{
  root: ReactRoot;
  container: Node;
}> {
  return Array.from({ length: iterations }, () => {
    const container = createBenchmarkContainer();
    return { root: createReactRoot(container), container };
  });
}

function cleanupFigBenchmarkRoots(
  roots: Array<{ root: ReturnType<typeof createRoot>; container: Node }>,
) {
  for (const { root, container } of roots) {
    flushSync(() => root.unmount());
    container.parentNode?.removeChild(container);
  }
}

function cleanupReactBenchmarkRoots(
  roots: Array<{ root: ReactRoot; container: Node }>,
) {
  for (const { root, container } of roots) {
    reactFlushSync(() => root.unmount());
    container.parentNode?.removeChild(container);
  }
}

function createBenchmarkContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "benchmark-sandbox";
  document.body.appendChild(container);
  return container;
}

function clampRows(value: number): number {
  return Math.min(10000, Math.max(10, Math.round(value)));
}

function benchmarkComparisons(
  results: BenchmarkResult[],
): BenchmarkComparison[] {
  const comparisons = new Map<string, BenchmarkComparison>();

  for (const result of results) {
    const comparison = comparisons.get(result.name) ?? {
      name: result.name,
      rows: result.rows,
      notes: result.notes,
      fig: null,
      react: null,
    };

    if (result.runtime === "Fig") comparison.fig = result;
    else comparison.react = result;
    comparisons.set(result.name, comparison);
  }

  return [...comparisons.values()];
}

function benchmarkMaxMedian(comparison: BenchmarkComparison): number {
  return Math.max(
    comparison.fig?.median ?? 0,
    comparison.react?.median ?? 0,
    1,
  );
}

function benchmarkDelta(comparison: BenchmarkComparison): {
  kind: "faster" | "slower" | "same" | "unknown";
  text: string;
} {
  const fig = comparison.fig?.median;
  const react = comparison.react?.median;

  if (fig === undefined || react === undefined) {
    return { kind: "unknown", text: "—" };
  }

  if (react === 0) {
    return fig === 0
      ? { kind: "same", text: "Same" }
      : { kind: "unknown", text: "React rounded to 0 ms" };
  }

  const percent = ((fig - react) / react) * 100;
  if (Math.abs(percent) < 0.5) return { kind: "same", text: "Same" };

  return percent > 0
    ? { kind: "slower", text: `Fig ${formatPercent(percent)} slower` }
    : { kind: "faster", text: `Fig ${formatPercent(-percent)} faster` };
}

function formatPercent(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function formatOperations(operations: BenchmarkOperations | undefined): string {
  if (operations === undefined) return "—";

  const entries: string[] = [];
  if (operations.createInstance > 0)
    entries.push(`create:${operations.createInstance}`);
  if (operations.createTextInstance > 0)
    entries.push(`text:${operations.createTextInstance}`);
  if (operations.appendChild > 0)
    entries.push(`append:${operations.appendChild}`);
  if (operations.insertBefore > 0)
    entries.push(`insert:${operations.insertBefore}`);
  if (operations.commitTextUpdate > 0)
    entries.push(`textUpdate:${operations.commitTextUpdate}`);
  if (operations.removeChild > 0)
    entries.push(`remove:${operations.removeChild}`);
  return entries.length === 0 ? "none" : entries.join(", ");
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Could not find #root.");
}

createRoot(container).render(<App />);
