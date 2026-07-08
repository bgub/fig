import {
  Activity,
  type FigNode,
  lazy,
  readPromise,
  Suspense,
  useState,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { flushSync, on } from "@bgub/fig-dom";
import {
  dataResource,
  readData,
  readDataStore,
  type DataRefreshResult,
  type DataResource,
  type DataResourceKey,
} from "@bgub/fig";

type Resource<T> = Promise<T> | T;

export interface ServerInfo {
  region: string;
  renderedAt: string;
  runtime: string;
}

export interface ServerOnlyInfo {
  region: string;
  requestId: string;
  runtime: string;
}

export const serverInfoResourceId = "demo-ssr#server-info";

export const demoDataEndpointPath = "/__fig/data";

export function serverInfoKey(): DataResourceKey {
  return ["server-info"];
}

// SSR passes the server loader for the initial render. In the browser this
// isomorphic resource's own loader refreshes through the demo's handwritten
// /__fig/data endpoint — without a framework, a "remote" resource is just a
// resource whose loader calls an endpoint the app owns.
export const serverInfoRemoteResource = dataResource<[], ServerInfo>({
  key: serverInfoKey,
  load: async ({ signal }) => {
    const response = await fetch(demoDataEndpointPath, {
      body: JSON.stringify({ args: [], id: serverInfoResourceId }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Data resource request failed with status ${response.status}.`,
      );
    }

    const body = (await response.json()) as { value?: ServerInfo };
    if (body.value === undefined) {
      throw new Error("Data resource response carried no value.");
    }
    return body.value;
  },
});

export function serverOnlyInfoKey(): DataResourceKey {
  return ["server-only-info"];
}

export const serverOnlyInfoHydrationResource = dataResource<[], ServerOnlyInfo>(
  {
    key: serverOnlyInfoKey,
  },
);

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

// Scales the demo's artificial streaming delays so e2e runs don't wait out
// the human-readable timings; the copy still describes the unscaled values.
// The client bundle has no env (typeof guard), so it keeps the 1x delays.
const demoDelayScale =
  typeof process === "undefined"
    ? 1
    : Number(process.env.FIG_STREAM_DEMO_DELAY_SCALE ?? "1") || 1;

export function scaledDemoDelay(ms: number): number {
  return Math.max(1, Math.round(ms * demoDelayScale));
}

const LazyStreamPanel = lazy(() =>
  delay(LazyPanelContent, scaledDemoDelay(1300)),
);

export function App({
  request,
  serverInfoResource = serverInfoRemoteResource,
  serverOnlyInfoResource = serverOnlyInfoHydrationResource,
}: {
  request: DemoRequest;
  serverInfoResource?: DataResource<[], ServerInfo>;
  serverOnlyInfoResource?: DataResource<[], ServerOnlyInfo>;
}) {
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
            <ServerInfoPanel resource={serverInfoResource} />
            <ServerOnlyInfoPanel resource={serverOnlyInfoResource} />
            <Suspense
              fallback={
                <ViewTransition
                  default="ssr-stream-vt"
                  name="ssr-suspense"
                  share="ssr-stream-vt"
                >
                  <Panel
                    class="suspense-panel"
                    description="Pending fallback for 5 seconds."
                    tag="pending"
                    title="Suspense"
                    tone="warn"
                  />
                </ViewTransition>
              }
            >
              <ViewTransition
                default="ssr-stream-vt"
                name="ssr-suspense"
                share="ssr-stream-vt"
              >
                <SuspenseContent resource={request.resources.suspense} />
              </ViewTransition>
            </Suspense>
            <Suspense
              fallback={
                <ViewTransition
                  default="ssr-stream-vt"
                  name="ssr-error-recovery"
                  share="ssr-stream-vt"
                >
                  <Panel
                    class="error-panel"
                    description="Server render failed; waiting for client recovery."
                    tag="error"
                    title="Error recovery"
                    tone="danger"
                  />
                </ViewTransition>
              }
            >
              <ViewTransition
                default="ssr-stream-vt"
                name="ssr-error-recovery"
                share="ssr-stream-vt"
              >
                <ErrorRecoveryContent resource={request.resources.broken} />
              </ViewTransition>
            </Suspense>
            <Suspense
              fallback={
                <ViewTransition
                  default="ssr-stream-vt"
                  name="ssr-lazy-panel"
                  share="ssr-stream-vt"
                >
                  <Panel
                    class="lazy-panel"
                    description="Loading an async component module."
                    tag="lazy"
                    title="Lazy component"
                    tone="warn"
                  />
                </ViewTransition>
              }
            >
              <ViewTransition
                default="ssr-stream-vt"
                name="ssr-lazy-panel"
                share="ssr-stream-vt"
              >
                <LazyStreamPanel />
              </ViewTransition>
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
      broken: rejectAfter(new Error("server error demo"), scaledDemoDelay(900)),
      suspense: delay(
        "Content resolved on the server after 5 seconds.",
        scaledDemoDelay(5000),
      ),
      hidden: delay(
        "Hidden Activity content rendered on the server.",
        scaledDemoDelay(800),
      ),
      hiddenBroken: rejectAfter(
        new Error("hidden activity server error"),
        scaledDemoDelay(700),
      ),
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

function ServerInfoPanel({
  resource,
}: {
  resource: DataResource<[], ServerInfo>;
}) {
  const data = readDataStore();
  const info = readData(resource);

  return (
    <Panel
      class="data-panel"
      description={
        <span data-ssr-data-value="server-info">
          {info.region} · rendered at {info.renderedAt}
        </span>
      }
      tag="hydrated"
      title="Server data resource"
      tone="ok"
    >
      <p class="muted" data-ssr-data-kind="isomorphic">
        Loaded on the server ({info.runtime}) and hydrated by key, so the client
        reuses this value without a refetch.
      </p>
      <div class="panel-actions">
        <button
          class="button primary"
          data-demo-control="refresh-server-data"
          events={[
            on("click", () => {
              void data.refreshData(resource);
            }),
          ]}
          type="button"
        >
          Refresh data resource
        </button>
        <button
          class="button"
          data-demo-control="invalidate-server-data-key"
          events={[
            on("click", () => {
              data.invalidateDataKey(serverInfoKey());
            }),
          ]}
          type="button"
        >
          Invalidate exact key
        </button>
      </div>
    </Panel>
  );
}

function ServerOnlyInfoPanel({
  resource,
}: {
  resource: DataResource<[], ServerOnlyInfo>;
}) {
  const data = readDataStore();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const info = readData(resource);

  return (
    <Panel
      class="data-panel"
      description={`${info.region} · request ${info.requestId}`}
      tag="server-only"
      title="Server-only data"
      tone="ok"
    >
      <p class="muted" data-ssr-data-kind="server-only">
        Loaded only by the server renderer ({info.runtime}) and hydrated into
        the client store under the shared identity key.
      </p>
      <div class="panel-actions">
        <button
          class="button"
          data-demo-control="refresh-server-only-data"
          events={[
            on("click", () => {
              void data.refreshData(resource).then(
                (result) => setRefreshMessage(refreshResultMessage(result)),
                (error: unknown) =>
                  setRefreshMessage(`Refresh failed: ${errorMessage(error)}`),
              );
            }),
          ]}
          type="button"
        >
          Refresh anyways (errors)
        </button>
      </div>
      {refreshMessage === null ? null : (
        <p class="muted" data-ssr-data-error="">
          {refreshMessage}
        </p>
      )}
    </Panel>
  );
}

function refreshResultMessage<T>(result: DataRefreshResult<T>): string {
  switch (result.status) {
    case "fulfilled":
      return "Refresh unexpectedly succeeded.";
    case "rejected":
      return `Refresh failed: ${errorMessage(result.error)}`;
    case "aborted":
      return `Refresh aborted: ${result.reason}.`;
    case "unsupported":
      return `Unsupported refresh: ${result.reason}.`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    <ViewTransition name="ssr-client-transition" update="ssr-client-vt">
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
    </ViewTransition>
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
          events={[on("click", () => flushSync(() => setRevealed(true)))]}
          type="button"
        >
          {revealed ? "Hidden activity revealed" : "Reveal hidden activity"}
        </button>
      </div>
      <Activity mode={revealed ? "visible" : "hidden"}>
        <Suspense
          fallback={
            <ViewTransition
              default="ssr-stream-vt"
              name="ssr-hidden-activity"
              share="ssr-stream-vt"
            >
              <p data-hidden-fallback="">Hidden activity fallback.</p>
            </ViewTransition>
          }
        >
          <ViewTransition
            default="ssr-stream-vt"
            name="ssr-hidden-activity"
            share="ssr-stream-vt"
          >
            <HiddenActivityContent resource={resource} />
          </ViewTransition>
        </Suspense>
        <Suspense
          fallback={
            <ViewTransition
              default="ssr-stream-vt"
              name="ssr-hidden-error"
              share="ssr-stream-vt"
            >
              <p data-hidden-error-fallback="">Hidden error fallback.</p>
            </ViewTransition>
          }
        >
          <ViewTransition
            default="ssr-stream-vt"
            name="ssr-hidden-error"
            share="ssr-stream-vt"
          >
            <HiddenErrorContent resource={errorResource} />
          </ViewTransition>
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
