import "./dev-env.ts";
import {
  createContext,
  type FigNode,
  lazy,
  readContext,
  readPromise,
  Suspense,
  transition,
  useBeforePaint,
  useLaggedValue,
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
let currentDemoPage: Page | null = null;

const pages: Array<{ id: Page; label: string; shortLabel: string }> = [
  { id: "state", label: "State + diffing", shortLabel: "State" },
  { id: "effects", label: "Effects + bind", shortLabel: "Effects" },
  { id: "async", label: "Async event signals", shortLabel: "Async" },
  { id: "resources", label: "Context + lazy", shortLabel: "Lazy" },
  { id: "hydration", label: "Hydration", shortLabel: "Hydration" },
  { id: "benchmarks", label: "Benchmarks", shortLabel: "Benchmarks" },
];

const initialItems: DemoItem[] = [
  { id: 1, label: "Parse JSX", tone: "core" },
  { id: 2, label: "Build fibers", tone: "render" },
  { id: 3, label: "Commit DOM", tone: "dom" },
];

const LazyFeatureCard = lazy(() => delayValue(FeatureCard, 650));

const ThemeContext = createContext("light");

type HydrationWrapper = "section" | "article";
type ReplaySuspenseMarker = Comment & { __figRetry?: () => void };

const hydrationDemo = {
  root: null as ReturnType<typeof createRoot> | null,
  sandbox: null as HTMLDivElement | null,
};

const replayDemo = {
  button: null as HTMLButtonElement | null,
  placeholder: null as HTMLTemplateElement | null,
  root: null as ReturnType<typeof createRoot> | null,
  sandbox: null as HTMLDivElement | null,
  start: null as ReplaySuspenseMarker | null,
  target: null as HTMLDivElement | null,
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
    <section class="page">
      <div class="page-header">
        <div>
          <h2>{title}</h2>
          <p class="lede">{lede}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Row({ children }: { children: FigNode }) {
  return <div class="row">{children}</div>;
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
      class={primary ? "button primary" : "button"}
      events={[on("click", run)]}
    >
      {children}
    </button>
  );
}

function App() {
  const [page, setPage] = useState(() => {
    const initialPage = readInitialPage();
    currentDemoPage = initialPage;
    return initialPage;
  });

  const navigate = (nextPage: Page) => {
    if (!setDemoPage(nextPage, setPage)) return;

    window.localStorage.setItem("fig-demo-page", nextPage);
    window.history.replaceState(null, "", `#${nextPage}`);
  };

  useReactive((signal) => {
    const onHashChange = () => {
      setDemoPage(readInitialPage(), setPage);
    };
    window.addEventListener("hashchange", onHashChange, { signal });
  }, []);

  return (
    <div class="shell">
      <header class="topbar">
        <div class="topbar-inner">
          <h1 class="brand">Fig Demo</h1>
          <nav class="nav" aria-label="Demo sections">
            {pages.map((item) => (
              <button
                key={item.id}
                type="button"
                class={item.id === page ? "active" : ""}
                events={[on("click", () => navigate(item.id))]}
              >
                <span class="nav-label">{item.label}</span>
                <span class="nav-short-label">{item.shortLabel}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main class="content">{pageView(page)}</main>
    </div>
  );
}

function readInitialPage(): Page {
  return (
    pageFromString(window.location.hash.slice(1)) ??
    pageFromString(window.localStorage.getItem("fig-demo-page")) ??
    "hydration"
  );
}

function pageFromString(value: string | null): Page | null {
  if (value === "event-replay") return "hydration";
  return pages.some((item) => item.id === value) ? (value as Page) : null;
}

function pageView(page: Page) {
  switch (page) {
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
  const [items, setItems] = useState(() => initialItems);
  const [nextId, setNextId] = useState(4);

  return (
    <PageFrame
      title="State + diffing"
      lede="State updates, batched events, and keyed list diffing."
    >
      <div class="columns">
        <section class="card">
          <div class="card-header">
            <h3>Counter</h3>
            <p class="hint">
              Batched state updates coalesce into a single render.
            </p>
          </div>
          <Row>
            <span class="metric">{count}</span>
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
          <p class="hint">{lastAction}</p>
        </section>

        <LaggedCounterCard />

        <section class="card">
          <div class="card-header">
            <h3>Keyed list</h3>
            <p class="hint">
              Keyed children are diffed by identity, not position.
            </p>
          </div>
          <Row>
            <Command
              primary
              run={() => setItems((value) => value.toReversed())}
            >
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
        </section>
      </div>
    </PageFrame>
  );
}

function LaggedCounterCard() {
  const [input, setInput] = useState(0);
  const lagged = useLaggedValue(input);

  return (
    <section class="card">
      <div class="card-header">
        <h3>Lagged value</h3>
        <p class="hint">
          Urgent input updates render immediately while derived output catches
          up in deferred work.
        </p>
      </div>
      <div class="deferred-meter">
        <span>
          Input <strong>{input}</strong>
        </span>
        <span>
          Lagged <strong>{lagged}</strong>
        </span>
      </div>
      <Row>
        <Command primary run={() => setInput((value) => value + 1)}>
          Update input
        </Command>
        <Command
          run={() => {
            setInput((value) => value + 1);
            setInput((value) => value + 1);
          }}
        >
          Queue two
        </Command>
      </Row>
    </section>
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

  useReactive((signal) => {
    log("useReactive []");
    signal.addEventListener(
      "abort",
      () => console.log("Effects page unmounted"),
      {
        once: true,
      },
    );
  }, []);

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
          class="input"
          bind={focusBoundInput}
          value={`Bound input, tick ${tick}`}
        />
        <Command primary run={() => setTick((value) => value + 1)}>
          Tick effects
        </Command>
      </Row>
      <pre class="log">{logs.join("\n")}</pre>
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
        class="input"
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
      <p class="hint">{status}</p>
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
      title="Context + lazy"
      lede="Context reads, promise suspension, lazy component loading, and transition retries."
    >
      <ThemeContext value={theme}>
        <div class="columns">
          <section class="card">
            <div class="card-header">
              <h3>Context + promise reads</h3>
              <p class="hint">
                Promise reads suspend locally; transitions keep revealed content
                visible.
              </p>
            </div>
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
                  setMessagePromise(
                    delayedMessage(messageText("Resolved", theme)),
                  )
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
              <p class="hint">No promise read yet.</p>
            ) : (
              <Suspense fallback={<p class="hint">Loading message...</p>}>
                <PromiseMessage promise={messagePromise} />
              </Suspense>
            )}
          </section>
          <Suspense fallback={<LazyFeatureFallback />}>
            <LazyFeatureCard />
          </Suspense>
        </div>
      </ThemeContext>
    </PageFrame>
  );
}

function FeatureCard() {
  return (
    <section class="card lazy-card">
      <div class="card-header">
        <h3>Lazy component</h3>
        <p class="hint">
          `lazy(load)` turns an async component loader into a component that
          suspends under Suspense.
        </p>
      </div>
      <div class="hydration-status">
        <span class="tag">loaded</span>
        <span>Feature module resolved and rendered.</span>
      </div>
    </section>
  );
}

function LazyFeatureFallback() {
  return (
    <section class="card lazy-card">
      <div class="card-header">
        <h3>Lazy component</h3>
        <p class="hint">Loading component module...</p>
      </div>
      <div class="hydration-status">
        <span class="tag">pending</span>
        <span>Suspense is showing this fallback.</span>
      </div>
    </section>
  );
}

function HydrationPage() {
  const [serverHtml, setServerHtml] = useState("");
  const [hydrationStatus, setHydrationStatus] = useState(
    "Rendering matching server HTML...",
  );
  const [replayStatus, setReplayStatus] = useState(
    "Mounting a pending Suspense boundary...",
  );
  const [recoverableErrors, setRecoverableErrors] = useState<string[]>([]);
  const [replayLogs, setReplayLogs] = useState<string[]>([]);

  const logReplay = (message: string) => {
    setReplayLogs((value) =>
      [...value, `${new Date().toLocaleTimeString()}  ${message}`].slice(-8),
    );
  };

  const runDemo = async (mismatch: boolean, signal?: AbortSignal) => {
    const sandbox = hydrationDemo.sandbox;
    if (sandbox === null) {
      setHydrationStatus("Hydration sandbox is not mounted yet.");
      return;
    }

    setHydrationStatus("Rendering HTML with @bgub/fig-server...");
    setRecoverableErrors([]);
    resetHydrationDemoRoot();
    sandbox.replaceChildren();

    const { html, servedAt } = await renderHydrationHtml(mismatch);
    if (signal?.aborted === true || hydrationDemo.sandbox !== sandbox) return;

    const target = hydrationTarget(html);
    sandbox.replaceChildren(target);
    setServerHtml(html);
    setHydrationStatus(
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
            setHydrationStatus(
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
            setHydrationStatus("Mismatch recovered with a client render.");
          },
        },
      );
    });

    if (!mismatch) setHydrationStatus("Hydrated matching server HTML.");
  };

  const mountPendingBoundary = () => {
    const sandbox = replayDemo.sandbox;
    if (sandbox === null) {
      setReplayStatus("Replay sandbox is not mounted yet.");
      return;
    }

    resetReplayDemoRoot();
    setReplayLogs([]);

    const target = replayTarget();
    sandbox.replaceChildren(target);

    const refs = replayBoundaryRefs(target);
    if (refs === null) {
      setReplayStatus("Could not find replay boundary markers.");
      return;
    }

    replayDemo.button = refs.button;
    replayDemo.placeholder = refs.placeholder;
    replayDemo.start = refs.start;
    replayDemo.target = target;

    flushSync(() => {
      replayDemo.root = hydrateRoot(
        target,
        <ReplayIsland
          onChildAction={() => logReplay("child handler ran")}
          onParentAction={() => logReplay("parent handler ran")}
        />,
      );
    });

    setReplayStatus("Pending boundary mounted.");
  };

  const dispatchPendingClick = () => {
    if (replayDemo.button === null) {
      setReplayStatus("Mount a pending boundary first.");
      return;
    }

    replayDemo.button.click();
    setReplayStatus("Click dispatched while Suspense is pending.");
  };

  const completeBoundary = (replaceTarget: boolean) => {
    const start = replayDemo.start;
    const placeholder = replayDemo.placeholder;

    if (start === null || placeholder === null) {
      setReplayStatus("Mount a pending boundary first.");
      return;
    }

    if (replaceTarget) replaceReplayTarget();

    start.data = "fig:suspense:completed";
    placeholder.remove();
    replayDemo.placeholder = null;
    start.__figRetry?.();
    setReplayStatus(
      replaceTarget
        ? "Boundary completed after replacing the original target."
        : "Boundary completed with the original target preserved.",
    );
  };

  useReactive((signal) => {
    void runDemo(false, signal);
    mountPendingBoundary();
  }, []);

  return (
    <PageFrame
      title="Hydration"
      lede="Server render, hydrate, mismatch recovery, and pending boundary event replay."
    >
      <div class="columns">
        <section class="card">
          <div class="card-header">
            <h3>SSR hydration</h3>
            <p class="hint">
              Server HTML is inserted into the sandbox, then `hydrateRoot`
              claims it.
            </p>
            <Row>
              <Command primary run={() => void runDemo(false)}>
                Hydrate matching
              </Command>
              <Command run={() => void runDemo(true)}>Recover mismatch</Command>
            </Row>
          </div>
          <div class="hydration-status">
            <span class="tag">Status</span>
            <span>{hydrationStatus}</span>
          </div>
          {recoverableErrors.length > 0 ? (
            <ul class="list">
              {recoverableErrors.map((message) => (
                <li class="item" key={message}>
                  <span>{message}</span>
                  <span class="tag">recoverable</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div class="hydration-output">
            <h4>Server HTML</h4>
            <pre class="code">{serverHtml || "No server render yet."}</pre>
          </div>
          <div class="hydration-output">
            <h4>Hydrated DOM</h4>
            <div class="hydration-sandbox" bind={hydrationSandboxBind} />
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h3>Hydration event replay</h3>
            <p class="hint">
              A click on a pending Suspense boundary is queued until that
              boundary hydrates.
            </p>
            <Row>
              <Command run={mountPendingBoundary}>Reset boundary</Command>
              <Command primary run={dispatchPendingClick}>
                Click pending target
              </Command>
              <Command run={() => completeBoundary(false)}>
                Complete, keep target
              </Command>
              <Command run={() => completeBoundary(true)}>
                Complete, replace target
              </Command>
            </Row>
          </div>
          <div class="hydration-status">
            <span class="tag">Status</span>
            <span>{replayStatus}</span>
          </div>
          <div class="hydration-output">
            <h4>Replay target</h4>
            <div
              class="hydration-sandbox replay-sandbox"
              bind={replaySandboxBind}
            />
          </div>
          <div class="hydration-output">
            <h4>Event log</h4>
            <pre class="log">
              {replayLogs.join("\n") || "No Fig handlers yet."}
            </pre>
          </div>
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
  target.setAttribute("class", "hydration-target");
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
      <div class="row">
        <span class="metric">SSR</span>
        <span class="tag">{mode}</span>
      </div>
      <p class="hint">
        This subtree was rendered to HTML first, then claimed by hydrateRoot.
      </p>
      <p class="server-stamp">Server-rendered at {servedAt}</p>
      <button
        type="button"
        class="button primary"
        events={[on("click", () => onAction?.())]}
      >
        Test hydrated event
      </button>
    </>
  );

  const Element = wrapper;
  return (
    <Element class="hydration-card" data-mode={mode}>
      {content}
    </Element>
  );
}

function ReplayIsland({
  onChildAction,
  onParentAction,
}: {
  onChildAction: () => void;
  onParentAction: () => void;
}) {
  return (
    <section
      class="replay-parent"
      events={[on("click", () => onParentAction())]}
    >
      <Suspense fallback={<ReplayButton label="Pending target" />}>
        <ReplayButton
          label="Hydrated target"
          onAction={(event) => {
            event.stopPropagation();
            onChildAction();
          }}
        />
      </Suspense>
    </section>
  );
}

function ReplayButton({
  label,
  onAction,
}: {
  label: string;
  onAction?: (event: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      class="button primary replay-action"
      events={onAction === undefined ? undefined : [on("click", onAction)]}
    >
      {label}
    </button>
  );
}

const hydrationSandboxBind: Bind<HTMLDivElement> = (node, signal) => {
  hydrationDemo.sandbox = node;
  signal.addEventListener(
    "abort",
    () => {
      if (hydrationDemo.sandbox === node) hydrationDemo.sandbox = null;
    },
    { once: true },
  );
};

const replaySandboxBind: Bind<HTMLDivElement> = (node, signal) => {
  replayDemo.sandbox = node;
  signal.addEventListener(
    "abort",
    () => {
      if (replayDemo.sandbox === node) replayDemo.sandbox = null;
    },
    { once: true },
  );
};

function setDemoPage(nextPage: Page, setPage: (page: Page) => void): boolean {
  const previousPage = currentDemoPage;
  if (nextPage === previousPage) return false;

  if (previousPage !== null) cleanupDemoPage(previousPage);
  currentDemoPage = nextPage;
  setPage(nextPage);
  return true;
}

function cleanupDemoPage(page: Page): void {
  if (page === "hydration") {
    resetHydrationDemoRoot();
    resetReplayDemoRoot();
  }
}

function resetHydrationDemoRoot(): void {
  const root = hydrationDemo.root;
  if (root === null) return;

  hydrationDemo.root = null;
  flushSync(() => root.unmount());
}

function resetReplayDemoRoot(): void {
  const root = replayDemo.root;

  replayDemo.button = null;
  replayDemo.placeholder = null;
  replayDemo.root = null;
  replayDemo.start = null;
  replayDemo.target = null;

  if (root === null) return;
  flushSync(() => root.unmount());
}

function replayTarget(): HTMLDivElement {
  const target = document.createElement("div");
  target.setAttribute("class", "hydration-target replay-target");
  target.innerHTML = pendingReplayHtml();
  return target;
}

function pendingReplayHtml(): string {
  return [
    '<section class="replay-parent">',
    "<!--fig:suspense:pending:0-->",
    '<template id="b-0"></template>',
    '<button type="button" class="button primary replay-action" data-replay-button="true">Pending target</button>',
    "<!--/fig:suspense-->",
    "</section>",
  ].join("");
}

function replayBoundaryRefs(target: HTMLDivElement): {
  button: HTMLButtonElement;
  placeholder: HTMLTemplateElement;
  start: ReplaySuspenseMarker;
} | null {
  const button = target.querySelector<HTMLButtonElement>(
    "[data-replay-button]",
  );
  const placeholder = target.querySelector<HTMLTemplateElement>("template");
  const start = findReplayStart(target);

  if (button === null || placeholder === null || start === null) return null;
  return { button, placeholder, start };
}

function findReplayStart(target: HTMLDivElement): ReplaySuspenseMarker | null {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_COMMENT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const comment = node as ReplaySuspenseMarker;
    if (comment.data.startsWith("fig:suspense:pending:")) return comment;
  }

  return null;
}

function replaceReplayTarget(): void {
  const button = replayDemo.button;
  if (button === null) return;

  const replacement = document.createElement("button");
  replacement.type = "button";
  replacement.setAttribute("class", "button primary replay-action");
  replacement.textContent = "Replacement target";
  button.replaceWith(replacement);
  replayDemo.button = replacement;
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
        <label class="field">
          Rows
          <input
            class="input small"
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
      <p class="hint">{status}</p>
      {results.length === 0 ? (
        <p class="hint">
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
    <table class="benchmark-table">
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
              <td class="ops-cell">
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
  if (result === null) return <span class="hint">—</span>;

  const width = Math.max(2, (result.median / max) * 100);

  return (
    <div class="benchmark-measure">
      <div class="benchmark-measure-label">
        <span class={`runtime ${result.runtime.toLowerCase()}`}>
          {result.runtime}
        </span>
        <strong>{formatMs(result.median)}</strong>
      </div>
      <div class="benchmark-bar" title="Longer bars are slower.">
        <div
          class={`benchmark-bar-fill ${result.runtime.toLowerCase()}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div class="benchmark-range">
        {formatMs(result.min)} – {formatMs(result.max)} · ×{result.iterations}
        /sample
      </div>
    </div>
  );
}

function BenchmarkDelta({ comparison }: { comparison: BenchmarkComparison }) {
  const delta = benchmarkDelta(comparison);
  return <span class={`benchmark-delta ${delta.kind}`}>{delta.text}</span>;
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

  return <span class="metric">{theme}</span>;
}

function PromiseMessage({ promise }: { promise: Promise<string> }) {
  return <p class="hint">{readPromise(promise)}</p>;
}

function DemoList({ items }: { items: DemoItem[] }) {
  return (
    <ul class="list">
      {items.map((item) => (
        <li class="item" key={item.id}>
          <span>{item.label}</span>
          <span class="tag">{item.tone}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultList({ results }: { results: string[] }) {
  return (
    <ul class="list">
      {results.map((result) => (
        <li class="item" key={result}>
          <span>{result}</span>
          <span class="tag">fresh</span>
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
    <ul class="benchmark-list">
      {rows.map((id) => (
        <li class="benchmark-row" key={id}>
          <span>
            {label} {id}
          </span>
          <span class="tag">v{version}</span>
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
    { class: "benchmark-list" },
    benchmarkRowIds(count, start, reverse).map((id) =>
      createElement(
        "li",
        { class: "benchmark-row", key: id },
        createElement("span", null, `${label} ${id}`),
        createElement("span", { class: "tag" }, `v${version}`),
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

function delayValue<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms);
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
  const appendChild = Reflect.get(
    Node.prototype,
    "appendChild",
  ) as typeof Node.prototype.appendChild;
  const insertBefore = Reflect.get(
    Node.prototype,
    "insertBefore",
  ) as typeof Node.prototype.insertBefore;
  const removeChild = Reflect.get(
    Node.prototype,
    "removeChild",
  ) as typeof Node.prototype.removeChild;
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
  container.setAttribute("class", "benchmark-sandbox");
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
