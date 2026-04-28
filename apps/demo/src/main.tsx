import {
  createContext,
  type FigNode,
  readContext,
  readPromise,
  Suspense,
  useBeforePaint,
  useOnMount,
  useReactive,
  useState,
} from "@bgub/fig";
import { type Bind, createRoot, on } from "@bgub/fig-dom";

type Page = "state" | "diffing" | "effects" | "async" | "resources";

interface DemoItem {
  id: number;
  label: string;
  tone: string;
}

const pages: Array<{ id: Page; label: string }> = [
  { id: "state", label: "State + events" },
  { id: "diffing", label: "Keyed diffing" },
  { id: "effects", label: "Effects + bind" },
  { id: "async", label: "Async event signals" },
  { id: "resources", label: "Context + promises" },
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
      lede="Context is read without hook slots. Pending promises render a local fallback and retry when settled."
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
              setMessagePromise(delayedMessage(`Resolved for ${theme} theme`))
            }
          >
            Read promise
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

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Could not find #root.");
}

createRoot(container).render(<App />);
