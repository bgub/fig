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
import { type Bind, createRoot, flushSync, on } from "@bgub/fig-dom";
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
  | "benchmarks";

interface DemoItem {
  id: number;
  label: string;
  tone: string;
}

type BenchmarkRuntime = "Fig" | "React";

interface BenchmarkResult {
  runtime: BenchmarkRuntime;
  name: string;
  rows: number;
  samples: number[];
  median: number;
  min: number;
  max: number;
  notes: string;
}

const pages: Array<{ id: Page; label: string }> = [
  { id: "state", label: "State + events" },
  { id: "diffing", label: "Keyed diffing" },
  { id: "effects", label: "Effects + bind" },
  { id: "async", label: "Async event signals" },
  { id: "resources", label: "Context + promises" },
  { id: "benchmarks", label: "Benchmarks" },
];

const initialItems: DemoItem[] = [
  { id: 1, label: "Parse JSX", tone: "core" },
  { id: 2, label: "Build fibers", tone: "render" },
  { id: 3, label: "Commit DOM", tone: "dom" },
];

const ThemeContext = createContext("light");

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
  const [page, setPage] = useState<Page>("state");

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
          Results measure median synchronous `flushSync` time across five runs
          for both Fig and React. Use them for relative comparisons, not
          absolute browser benchmarks.
        </p>
      ) : (
        <BenchmarkTable results={results} />
      )}
    </PageFrame>
  );
}

function BenchmarkTable({ results }: { results: BenchmarkResult[] }) {
  return (
    <table className="benchmark-table">
      <thead>
        <tr>
          <th>Runtime</th>
          <th>Scenario</th>
          <th>Rows</th>
          <th>Median</th>
          <th>Min</th>
          <th>Max</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={`${result.runtime}:${result.name}`}>
            <td>
              <span className={`runtime ${result.runtime.toLowerCase()}`}>
                {result.runtime}
              </span>
            </td>
            <td>{result.name}</td>
            <td>{result.rows}</td>
            <td>{formatMs(result.median)}</td>
            <td>{formatMs(result.min)}</td>
            <td>{formatMs(result.max)}</td>
            <td>{result.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
      () => measureFigInitialMount(rows),
    ),
    measureBenchmark(
      "React",
      "Initial mount",
      rows,
      "Fresh root and host tree creation.",
      () => measureReactInitialMount(rows),
    ),
    measureBenchmark(
      "Fig",
      "Same-order update",
      rows,
      "Stable keys, changed row props/text.",
      () =>
        measureFigUpdate(
          <BenchmarkRows count={rows} version={1} />,
          <BenchmarkRows count={rows} version={2} />,
        ),
    ),
    measureBenchmark(
      "React",
      "Same-order update",
      rows,
      "Stable keys, changed row props/text.",
      () =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows, version: 1 }),
          reactBenchmarkElement({ count: rows, version: 2 }),
        ),
    ),
    measureBenchmark(
      "Fig",
      "Append 10%",
      rows,
      "Stable ordered keys plus new tail rows.",
      () =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows + appendCount} />,
        ),
    ),
    measureBenchmark(
      "React",
      "Append 10%",
      rows,
      "Stable ordered keys plus new tail rows.",
      () =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({ count: rows + appendCount }),
        ),
    ),
    measureBenchmark(
      "Fig",
      "Prepend 10%",
      rows,
      "New head rows before stable existing keys.",
      () =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows + appendCount} start={-appendCount} />,
        ),
    ),
    measureBenchmark(
      "React",
      "Prepend 10%",
      rows,
      "New head rows before stable existing keys.",
      () =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({
            count: rows + appendCount,
            start: -appendCount,
          }),
        ),
    ),
    measureBenchmark(
      "Fig",
      "Reverse keyed rows",
      rows,
      "Worst-case keyed reordering pressure.",
      () =>
        measureFigUpdate(
          <BenchmarkRows count={rows} />,
          <BenchmarkRows count={rows} reverse />,
        ),
    ),
    measureBenchmark(
      "React",
      "Reverse keyed rows",
      rows,
      "Worst-case keyed reordering pressure.",
      () =>
        measureReactUpdate(
          reactBenchmarkElement({ count: rows }),
          reactBenchmarkElement({ count: rows, reverse: true }),
        ),
    ),
  ];
}

function measureBenchmark(
  runtime: BenchmarkRuntime,
  name: string,
  rows: number,
  notes: string,
  measure: () => number,
): BenchmarkResult {
  measure();
  const samples: number[] = [];

  for (let index = 0; index < 5; index += 1) samples.push(measure());

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    runtime,
    name,
    rows,
    samples,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    notes,
  };
}

function measureFigInitialMount(rows: number): number {
  const container = createBenchmarkContainer();
  const root = createRoot(container);
  const duration = measureFigSync(() =>
    root.render(<BenchmarkRows count={rows} version={1} />),
  );
  cleanupFigBenchmarkRoot(root, container);
  return duration;
}

function measureReactInitialMount(rows: number): number {
  const container = createBenchmarkContainer();
  const root = createReactRoot(container);
  const duration = measureReactSync(() =>
    root.render(reactBenchmarkElement({ count: rows, version: 1 })),
  );
  cleanupReactBenchmarkRoot(root, container);
  return duration;
}

function measureFigUpdate(previous: FigNode, next: FigNode): number {
  const container = createBenchmarkContainer();
  const root = createRoot(container);
  flushSync(() => root.render(previous));
  const duration = measureFigSync(() => root.render(next));
  cleanupFigBenchmarkRoot(root, container);
  return duration;
}

function measureReactUpdate(previous: ReactNode, next: ReactNode): number {
  const container = createBenchmarkContainer();
  const root = createReactRoot(container);
  reactFlushSync(() => root.render(previous));
  const duration = measureReactSync(() => root.render(next));
  cleanupReactBenchmarkRoot(root, container);
  return duration;
}

function measureFigSync(callback: () => void): number {
  const start = performance.now();
  flushSync(callback);
  return performance.now() - start;
}

function measureReactSync(callback: () => void): number {
  const start = performance.now();
  reactFlushSync(callback);
  return performance.now() - start;
}

function cleanupFigBenchmarkRoot(
  root: ReturnType<typeof createRoot>,
  node: Node,
) {
  flushSync(() => root.unmount());
  node.parentNode?.removeChild(node);
}

function cleanupReactBenchmarkRoot(root: ReactRoot, node: Node) {
  reactFlushSync(() => root.unmount());
  node.parentNode?.removeChild(node);
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

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Could not find #root.");
}

createRoot(container).render(<App />);
