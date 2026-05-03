import { type FigNode, readPromise, Suspense, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

type Resource<T> = Promise<T> | T;

export interface DemoResources {
  broken: Resource<string>;
  suspense: Resource<string>;
}

export interface DemoRequest {
  abortDelay: number | null;
  resources: DemoResources;
  startedAt: string;
}

export type ClientData = Pick<DemoRequest, "abortDelay" | "startedAt">;

export const demoDataScriptId = "fig-stream-demo-data";
export const demoRootId = "fig-stream-demo-root";
export const streamBoundaryDigest = "stream-demo-suspense";
export const streamIdentifierPrefix = "stream-demo";

export function App({ request }: { request: DemoRequest }) {
  const mode = request.abortDelay === null ? "normal" : "abort";

  return (
    <div className="app" data-mode={mode}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">phi</span>
          <div>
            <h1>Streaming SSR</h1>
            <p>Fig server demo</p>
          </div>
        </div>
        <nav className="nav" aria-label="Streaming modes">
          <a className={mode === "normal" ? "active" : ""} href="/">
            Full stream
          </a>
          <a className={mode === "abort" ? "active" : ""} href="/abort">
            Abort after shell
          </a>
        </nav>
      </aside>
      <main className="content">
        <header className="header">
          <div>
            <h2>Fig streaming demo</h2>
            <p className="muted">
              Shell hydrates first; Suspense stays pending for 5 seconds.
            </p>
          </div>
          <div className="actions">
            <span className={mode === "abort" ? "tag warn" : "tag ok"}>
              {mode === "abort" ? "abort route" : "stream route"}
            </span>
            <CounterButton id="shell" label="Shell clicks" />
            <a className="button" href="/">
              Reload
            </a>
          </div>
        </header>
        <section className="grid">
          <Suspense fallback={<SuspenseFallback />}>
            <SuspensePanel resources={request.resources} />
          </Suspense>
          <div className="server-log">
            <ShellPanel abortDelay={request.abortDelay} />
            <Suspense fallback={<ServerErrorFallback />}>
              <ServerErrorPanel resource={request.resources.broken} />
            </Suspense>
          </div>
        </section>
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
      suspense: delay("Content resolved after 5 seconds.", 5000),
    },
    startedAt,
  };
}

export function createClientRequest(data: ClientData): DemoRequest {
  return {
    abortDelay: data.abortDelay,
    resources: {
      broken: "Client recovered after server error.",
      suspense: "Content resolved after 5 seconds.",
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

function ShellPanel({ abortDelay }: { abortDelay: number | null }) {
  return (
    <Panel
      description={
        abortDelay === null
          ? "Interactive before Suspense is revealed."
          : `Abort scheduled at ${abortDelay}ms.`
      }
      tag="ready"
      title="Shell"
      tone="ok"
    >
      <div className="code">
        shellReady resolved; client bootstrap loaded early.
      </div>
    </Panel>
  );
}

function SuspensePanel({ resources }: { resources: DemoResources }) {
  return (
    <Panel
      className="suspense-panel"
      description={readResource(resources.suspense)}
      tag="resolved"
      title="Suspense"
      tone="ok"
    >
      <div className="panel-actions">
        <CounterButton id="suspense" label="Suspense clicks" />
      </div>
    </Panel>
  );
}

function ServerErrorPanel({ resource }: { resource: Resource<string> }) {
  return (
    <Panel
      className="server-error-panel"
      description={readResource(resource)}
      tag="ready"
      title="Server error"
      tone="ok"
    >
      <div className="panel-actions">
        <CounterButton id="server-error" label="Error clicks" />
      </div>
    </Panel>
  );
}

function ServerErrorFallback() {
  return (
    <Panel
      className="server-error-panel"
      description="Fallback stays interactive."
      tag="fallback"
      title="Server error"
      tone="danger"
    >
      <div className="panel-actions">
        <CounterButton id="server-error-fallback" label="Fallback clicks" />
      </div>
    </Panel>
  );
}

function SuspenseFallback() {
  return (
    <Panel
      className="suspense-panel"
      description="Pending fallback for 5 seconds."
      tag="pending"
      title="Suspense"
      tone="warn"
    />
  );
}

function Panel({
  children,
  className,
  description,
  tag,
  title,
  tone,
}: {
  children?: FigNode;
  className?: string;
  description: FigNode;
  tag: string;
  title: string;
  tone: "danger" | "ok" | "warn";
}) {
  return (
    <section
      className={className === undefined ? "panel" : `panel ${className}`}
    >
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <span className={`tag ${tone}`}>{tag}</span>
      </div>
      {children}
    </section>
  );
}

function CounterButton({ id, label }: { id: string; label: string }) {
  const [count, setCount] = useState(0);

  return (
    <button
      className="button primary"
      data-demo-control={id}
      events={[on("click", () => setCount((value) => value + 1))]}
      type="button"
    >
      {label}: {count}
    </button>
  );
}

function readResource<T>(resource: Resource<T>): T {
  return isPromise(resource) ? readPromise(resource) : resource;
}

function isPromise<T>(value: Resource<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function rejectAfter(error: Error, ms: number): Promise<string> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}
