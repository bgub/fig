import { type FigNode, readPromise, Suspense, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

type Resource<T> = Promise<T> | T;

export interface DemoRequest {
  abortDelay: number | null;
  resources: {
    broken: Resource<string>;
    suspense: Resource<string>;
  };
  startedAt: string;
}

export type ClientData = Pick<DemoRequest, "abortDelay" | "startedAt">;

export const demoDataScriptId = "fig-stream-demo-data";
export const demoRootId = "fig-stream-demo-root";
export const streamBoundaryDigest = "stream-demo-suspense";
export const streamIdentifierPrefix = "stream-demo";

export function App({ request }: { request: DemoRequest }) {
  const isAbort = request.abortDelay !== null;

  return (
    <div className="app" data-mode={isAbort ? "abort" : "normal"}>
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="brand">Streaming SSR</h1>
          <nav className="nav" aria-label="Streaming modes">
            <a className={isAbort ? "" : "active"} href="/">
              Full stream
            </a>
            <a className={isAbort ? "active" : ""} href="/abort">
              Abort after shell
            </a>
          </nav>
        </div>
      </header>
      <main className="content">
        <div className="content-inner">
          <header className="header">
            <div>
              <h2>{isAbort ? "Abort after shell" : "Full stream"}</h2>
              <p className="muted">
                {isAbort
                  ? "Shell hydrates first; server aborts and Suspense resolves on the client."
                  : "Shell hydrates first; Suspense streams from the server after 5 seconds."}
              </p>
            </div>
            <div className="actions">
              <CounterButton id="shell" label="Shell clicks" />
              <a className="button" href="/">
                Reload
              </a>
            </div>
          </header>
          <section className="grid">
            <Suspense
              fallback={
                <Panel
                  className="suspense-panel"
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
                  className="error-panel"
                  description="Server render failed; waiting for client recovery."
                  tag="error"
                  title="Error recovery"
                  tone="danger"
                />
              }
            >
              <ErrorRecoveryContent resource={request.resources.broken} />
            </Suspense>
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

function SuspenseContent({ resource }: { resource: Resource<string> }) {
  return (
    <Panel
      className="suspense-panel"
      description={readResource(resource)}
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

function ErrorRecoveryContent({ resource }: { resource: Resource<string> }) {
  return (
    <Panel
      className="error-panel"
      description={readResource(resource)}
      tag="recovered"
      title="Error recovery"
      tone="ok"
    >
      <div className="panel-actions">
        <CounterButton id="server-error" label="Error clicks" />
      </div>
    </Panel>
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
      className={`panel tone-${tone}${className ? ` ${className}` : ""}`}
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
