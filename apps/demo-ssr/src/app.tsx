import {
  Activity,
  type FigNode,
  lazy,
  readPromise,
  Suspense,
  useState,
  useTransition,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { dataResource, readData } from "@bgub/fig-data";

type Resource<T> = Promise<T> | T;

export interface ServerInfo {
  region: string;
  renderedAt: string;
  runtime: string;
}

export interface ServerDataContext {
  info?: ServerInfo;
}

// Read on the server with request-scoped context, fulfilled into the store, and
// streamed to the client via getData() -> initialData. The client reads the
// hydrated value synchronously instead of recomputing it.
export const serverInfoResource = dataResource<
  [],
  ServerInfo,
  ServerDataContext
>({
  name: "ServerInfo",
  key: () => ["server-info"],
  load: ({ context }) =>
    context.info ?? {
      region: "unknown",
      renderedAt: new Date().toLocaleTimeString(),
      runtime: "client fallback (not hydrated)",
    },
});

export interface DemoRequest {
  abortDelay: number | null;
  resources: {
    broken: Resource<string>;
    suspense: Resource<string>;
    hidden: Resource<string>;
    hiddenBroken: Resource<string>;
  };
  startedAt: string;
}

export type ClientData = Pick<DemoRequest, "abortDelay" | "startedAt">;

export const demoDataScriptId = "fig-stream-demo-data";
export const demoDataResourceScriptId = "fig-stream-demo-data-resources";
export const demoRootId = "fig-stream-demo-root";
export const streamBoundaryDigest = "stream-demo-suspense";
export const streamIdentifierPrefix = "stream-demo";

const LazyStreamPanel = lazy(() => delay(LazyPanelContent, 1300));

export function App({ request }: { request: DemoRequest }) {
  const isAbort = request.abortDelay !== null;

  return (
    <div class="app" data-mode={isAbort ? "abort" : "normal"}>
      <header class="topbar">
        <div class="topbar-inner">
          <h1 class="brand">Streaming SSR</h1>
          <nav class="nav" aria-label="Streaming modes">
            <a class={isAbort ? "" : "active"} href="/">
              Full stream
            </a>
            <a class={isAbort ? "active" : ""} href="/abort">
              Abort after shell
            </a>
          </nav>
        </div>
      </header>
      <main class="content">
        <div class="content-inner">
          <header class="header">
            <div>
              <h2>{isAbort ? "Abort after shell" : "Full stream"}</h2>
              <p class="muted">
                {isAbort
                  ? "Shell hydrates first; server aborts and Suspense resolves on the client."
                  : "Shell hydrates first; Suspense streams from the server after 5 seconds."}
              </p>
            </div>
            <div class="actions">
              <CounterButton id="shell" label="Shell clicks" />
              <a class="button" href="/">
                Reload
              </a>
            </div>
          </header>
          <section class="grid">
            <ServerInfoPanel />
            <Suspense
              fallback={
                <Panel
                  class="suspense-panel"
                  description="Pending fallback for 5 seconds."
                  tag="pending"
                  title="Suspense"
                  tone="warn"
                />
              }
            >
              <SuspenseContent resource={request.resources.suspense} />
            </Suspense>
            <Suspense
              fallback={
                <Panel
                  class="error-panel"
                  description="Server render failed; waiting for client recovery."
                  tag="error"
                  title="Error recovery"
                  tone="danger"
                />
              }
            >
              <ErrorRecoveryContent resource={request.resources.broken} />
            </Suspense>
            <Suspense
              fallback={
                <Panel
                  class="lazy-panel"
                  description="Loading an async component module."
                  tag="lazy"
                  title="Lazy component"
                  tone="warn"
                />
              }
            >
              <LazyStreamPanel />
            </Suspense>
            <ClientTransitionPanel />
            <HiddenActivityPanel
              resource={request.resources.hidden}
              errorResource={request.resources.hiddenBroken}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

export function createServerRequest(
  abortDelay: number | null,
  startedAt: string,
): DemoRequest {
  return {
    abortDelay,
    resources: {
      broken: rejectAfter(new Error("server error demo"), 900),
      suspense: delay("Content resolved on the server after 5 seconds.", 5000),
      hidden: delay("Hidden Activity content rendered on the server.", 800),
      hiddenBroken: rejectAfter(new Error("hidden activity server error"), 700),
    },
    startedAt,
  };
}

export function createClientRequest(data: ClientData): DemoRequest {
  return {
    abortDelay: data.abortDelay,
    resources: {
      broken: "Recovered on the client after server error.",
      suspense:
        data.abortDelay !== null
          ? "Content resolved on the client after server abort."
          : "Content resolved on the server after 5 seconds.",
      // The client never resolves this: any content visible after the hidden
      // Activity reveals must be the server stream preserved in the template.
      hidden: new Promise<string>(() => {}),
      // The server rejected this boundary; the client recovers it on reveal.
      hiddenBroken: "Recovered on the client after hidden server error.",
    },
    startedAt: data.startedAt,
  };
}

export function clientDataFor(request: DemoRequest): ClientData {
  return {
    abortDelay: request.abortDelay,
    startedAt: request.startedAt,
  };
}

function ServerInfoPanel() {
  const info = readData(serverInfoResource);

  return (
    <Panel
      class="data-panel"
      description={`${info.region} · rendered at ${info.renderedAt}`}
      tag="hydrated"
      title="Server data resource"
      tone="ok"
    >
      <p class="muted">
        Loaded on the server ({info.runtime}) and hydrated by key, so the client
        reuses this value without a refetch.
      </p>
    </Panel>
  );
}

function SuspenseContent({ resource }: { resource: Resource<string> }) {
  return (
    <Panel
      class="suspense-panel"
      description={readResource(resource)}
      tag="resolved"
      title="Suspense"
      tone="ok"
    >
      <div class="panel-actions">
        <CounterButton id="suspense" label="Suspense clicks" />
      </div>
    </Panel>
  );
}

function ErrorRecoveryContent({ resource }: { resource: Resource<string> }) {
  return (
    <Panel
      class="error-panel"
      description={readResource(resource)}
      tag="recovered"
      title="Error recovery"
      tone="ok"
    >
      <div class="panel-actions">
        <CounterButton id="server-error" label="Error clicks" />
      </div>
    </Panel>
  );
}

function LazyPanelContent() {
  return (
    <Panel
      class="lazy-panel"
      description="The server streamed this panel after lazy(load) resolved."
      tag="loaded"
      title="Lazy component"
      tone="ok"
    >
      <p class="muted">
        This uses the same Suspense stream path as data reads, but the promise
        resolves to a component type.
      </p>
    </Panel>
  );
}

function ClientTransitionPanel() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<Resource<string>>(
    "Hydrated transition content is ready.",
  );

  return (
    <Panel
      class="transition-panel"
      description={
        <Suspense fallback="Loading transition content...">
          <TransitionMessage message={message} />
        </Suspense>
      }
      tag={isPending ? "pending" : "idle"}
      title="Client transition"
      tone={isPending ? "warn" : "ok"}
    >
      <div class="panel-actions">
        <button
          class="button primary"
          data-demo-control="transition"
          events={[
            on("click", () => {
              startTransition(async () => {
                await delay(undefined, 250);
                setMessage(
                  delay(
                    `Transition committed at ${new Date().toLocaleTimeString()}.`,
                    1200,
                  ),
                );
              });
            }),
          ]}
          type="button"
        >
          {isPending ? "Transition pending" : "Start transition"}
        </button>
      </div>
    </Panel>
  );
}

function TransitionMessage({ message }: { message: Resource<string> }) {
  return readResource(message);
}

// Two Suspense boundaries that suspend inside a hidden Activity. The success one
// resolves on the server: its completion streams into the activity's inert
// <template> (via the `ac` runtime op) and hydrates on reveal — the client
// promise never resolves, so any revealed content must be the server stream. The
// error one rejects on the server: it is marked client-render inside the template
// (via the `ax` runtime op) and recovers on the client when revealed.
function HiddenActivityPanel({
  resource,
  errorResource,
}: {
  resource: Resource<string>;
  errorResource: Resource<string>;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Panel
      class="hidden-activity-panel"
      description="Suspense content rendered on the server inside a hidden Activity."
      tag={revealed ? "revealed" : "hidden"}
      title="Hidden Activity"
      tone="ok"
    >
      <div class="panel-actions">
        <button
          class="button primary"
          data-demo-control="reveal-hidden"
          events={[on("click", () => setRevealed(true))]}
          type="button"
        >
          {revealed ? "Hidden activity revealed" : "Reveal hidden activity"}
        </button>
      </div>
      <Activity mode={revealed ? "visible" : "hidden"}>
        <Suspense
          fallback={<p data-hidden-fallback="">Hidden activity fallback.</p>}
        >
          <HiddenActivityContent resource={resource} />
        </Suspense>
        <Suspense
          fallback={<p data-hidden-error-fallback="">Hidden error fallback.</p>}
        >
          <HiddenErrorContent resource={errorResource} />
        </Suspense>
      </Activity>
    </Panel>
  );
}

function HiddenActivityContent({ resource }: { resource: Resource<string> }) {
  return <p data-hidden-content="">{readResource(resource)}</p>;
}

function HiddenErrorContent({ resource }: { resource: Resource<string> }) {
  return <p data-hidden-error="">{readResource(resource)}</p>;
}

function Panel({
  children,
  class: extraClass,
  description,
  tag,
  title,
  tone,
}: {
  children?: FigNode;
  class?: string;
  description: FigNode;
  tag: string;
  title: string;
  tone: "danger" | "ok" | "warn";
}) {
  return (
    <section class={`panel tone-${tone}${extraClass ? ` ${extraClass}` : ""}`}>
      <div class="panel-header">
        <div>
          <h3>{title}</h3>
          <p class="muted">{description}</p>
        </div>
        <span class={`tag ${tone}`}>{tag}</span>
      </div>
      {children}
    </section>
  );
}

function CounterButton({ id, label }: { id: string; label: string }) {
  const [count, setCount] = useState(0);

  return (
    <button
      class="button primary"
      data-demo-control={id}
      events={[on("click", () => setCount((value) => value + 1))]}
      type="button"
    >
      {label}: {count}
    </button>
  );
}

function readResource<T>(resource: Resource<T>): T {
  return typeof (resource as Promise<T>).then === "function"
    ? readPromise(resource as Promise<T>)
    : (resource as T);
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function rejectAfter(error: Error, ms: number): Promise<string> {
  const promise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(error), ms),
  );
  promise.catch(() => {});
  return promise;
}
