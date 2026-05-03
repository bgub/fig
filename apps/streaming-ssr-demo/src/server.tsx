import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readPromise, Suspense } from "@bgub/fig";
import { renderToReadableStream } from "@bgub/fig-server";
import { styles } from "./styles.ts";

interface Metric {
  label: string;
  value: string;
}

interface Activity {
  label: string;
  status: string;
}

interface ChartPoint {
  label: string;
  value: number;
}

interface DemoResources {
  activities: Promise<Activity[]>;
  broken: Promise<string>;
  chart: Promise<ChartPoint[]>;
  metrics: Promise<Metric[]>;
}

interface DemoRequest {
  abortDelay: number | null;
  nonce: string;
  resources: DemoResources;
  startedAt: string;
}

const port = Number(process.env.PORT ?? 4180);
const logRecoveredErrors = process.env.FIG_STREAM_DEMO_LOG_ERRORS === "1";

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end(`<!-- ${escapeComment(error)} -->`);
      return;
    }

    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Fig streaming SSR demo: http://127.0.0.1:${port}/`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${port}`);
  const url = new URL(request.url ?? "/", `http://${host}`);

  if (url.pathname === "/style.css") {
    send(response, 200, styles, {
      "cache-control": "no-store",
      "content-type": "text/css; charset=utf-8",
    });
    return;
  }

  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname !== "/" && url.pathname !== "/abort") {
    send(response, 404, "Not found", {
      "content-type": "text/plain; charset=utf-8",
    });
    return;
  }

  const abortDelay = abortDelayFor(url);
  const demoRequest: DemoRequest = {
    abortDelay,
    nonce: randomUUID(),
    resources: createResources(),
    startedAt: new Date().toLocaleTimeString(),
  };
  const render = renderToReadableStream(<App request={demoRequest} />, {
    identifierPrefix: "stream-demo",
    nonce: demoRequest.nonce,
    onError(error, info) {
      if (logRecoveredErrors) {
        console.error("Boundary recovered on the server", {
          error,
          stack: info.componentStack,
        });
      }
      return { digest: "stream-demo-boundary" };
    },
    onShellError(error) {
      console.error("Shell failed", error);
    },
  });

  let closed = false;
  response.on("close", () => {
    closed = true;
    render.abort("client disconnected");
  });

  try {
    await render.shellReady;
  } catch (error) {
    send(response, 500, shellErrorHtml(error), {
      "content-type": "text/html; charset=utf-8",
    });
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": render.contentType,
    "x-accel-buffering": "no",
  });
  await writeResponse(response, documentStart());

  const abortTimer =
    abortDelay === null
      ? null
      : setTimeout(
          () => render.abort(`aborted after ${abortDelay}ms`),
          abortDelay,
        );

  try {
    await pipeStream(render.stream, response);
  } finally {
    if (abortTimer !== null) clearTimeout(abortTimer);
    if (!closed && !response.writableEnded) {
      await writeResponse(response, documentEnd());
    }
    if (!closed && !response.writableEnded) response.end();
  }
}

function App({ request }: { request: DemoRequest }) {
  const mode = request.abortDelay === null ? "normal" : "abort";

  return (
    <div className="app" data-mode={mode}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">φ</span>
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
            <h2>Operations dashboard</h2>
            <p className="muted">Request started at {request.startedAt}</p>
          </div>
          <div className="actions">
            <span className={mode === "abort" ? "tag warn" : "tag ok"}>
              {mode === "abort" ? "abort route" : "stream route"}
            </span>
            <a className="button" href="/">
              Reload
            </a>
          </div>
        </header>
        <section className="grid">
          <Suspense fallback={<LoadingPanel title="Pipeline" />}>
            <PipelinePanel resources={request.resources} />
          </Suspense>
          <div className="server-log">
            <ShellPanel abortDelay={request.abortDelay} />
            <Suspense fallback={<RecoveredFallback />}>
              <RecoveredPanel promise={request.resources.broken} />
            </Suspense>
          </div>
        </section>
      </main>
    </div>
  );
}

function ShellPanel({ abortDelay }: { abortDelay: number | null }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Shell</h3>
          <p className="muted">
            {abortDelay === null
              ? "Initial HTML flushed while data is pending."
              : `Abort scheduled at ${abortDelay}ms.`}
          </p>
        </div>
        <span className="tag ok">ready</span>
      </div>
      <div className="code">shellReady resolved before allReady</div>
    </section>
  );
}

function PipelinePanel({ resources }: { resources: DemoResources }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Pipeline</h3>
          <p className="muted">Segments stream as each promise settles.</p>
        </div>
        <span className="tag ok">server</span>
      </div>
      <Metrics promise={resources.metrics} />
      <ActivityList promise={resources.activities} />
      <Chart promise={resources.chart} />
    </section>
  );
}

function Metrics({ promise }: { promise: Promise<Metric[]> }) {
  const metrics = readPromise(promise);

  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <div className="metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ActivityList({ promise }: { promise: Promise<Activity[]> }) {
  const activities = readPromise(promise);

  return (
    <ul className="list">
      {activities.map((activity) => (
        <li className="item" key={activity.label}>
          <span>{activity.label}</span>
          <span className="tag">{activity.status}</span>
        </li>
      ))}
    </ul>
  );
}

function Chart({ promise }: { promise: Promise<ChartPoint[]> }) {
  const points = readPromise(promise);

  return (
    <div className="bars">
      {points.map((point) => (
        <div className="bar" key={point.label}>
          <span>{point.label}</span>
          <div className="track">
            <div className="fill" style={{ "--value": `${point.value}%` }} />
          </div>
          <strong>{point.value}%</strong>
        </div>
      ))}
    </div>
  );
}

function RecoveredPanel({ promise }: { promise: Promise<string> }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Audit service</h3>
          <p className="muted">{readPromise(promise)}</p>
        </div>
        <span className="tag ok">ready</span>
      </div>
    </section>
  );
}

function RecoveredFallback() {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Audit service</h3>
          <p className="muted">Fallback remained after server recovery.</p>
        </div>
        <span className="tag danger">client</span>
      </div>
      <div className="code">__figSSR.x(...) emitted</div>
    </section>
  );
}

function LoadingPanel({ title }: { title: string }) {
  return (
    <section className="panel placeholder">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">Fallback shell</p>
        </div>
        <span className="tag warn">pending</span>
      </div>
      <div className="placeholder-line" />
      <div className="placeholder-line" />
      <div className="placeholder-line short" />
    </section>
  );
}

function createResources(): DemoResources {
  return {
    activities: delay(
      [
        { label: "Hydrate account rows", status: "queued" },
        { label: "Reprice subscriptions", status: "running" },
        { label: "Publish reconciliation report", status: "ready" },
      ],
      1100,
    ),
    broken: rejectAfter(new Error("audit service unavailable"), 850),
    chart: delay(
      [
        { label: "North", value: 72 },
        { label: "West", value: 48 },
        { label: "East", value: 88 },
        { label: "South", value: 61 },
      ],
      1750,
    ),
    metrics: delay(
      [
        { label: "Open", value: "128" },
        { label: "Blocked", value: "7" },
        { label: "SLA", value: "94%" },
      ],
      520,
    ),
  };
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function rejectAfter(error: Error, ms: number): Promise<string> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

function abortDelayFor(url: URL): number | null {
  if (url.pathname === "/abort") return 900;

  const value = url.searchParams.get("abort");
  if (value === null) return null;

  const delayMs = Number(value);
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : null;
}

function documentStart(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Fig Streaming SSR</title>",
    '<link rel="stylesheet" href="/style.css">',
    "</head>",
    "<body>",
  ].join("");
}

function documentEnd(): string {
  return "</body></html>";
}

async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value !== undefined) await writeResponse(response, value);
  }
}

function writeResponse(
  response: ServerResponse,
  chunk: string | Uint8Array,
): Promise<void> {
  if (response.destroyed || response.writableEnded) return Promise.resolve();
  if (response.write(chunk)) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      response.off("close", finish);
      response.off("drain", finish);
      response.off("error", finish);
      resolve();
    };

    response.once("close", finish);
    response.once("drain", finish);
    response.once("error", finish);
  });
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string>,
): void {
  response.writeHead(status, headers);
  response.end(body);
}

function shellErrorHtml(error: unknown): string {
  return `<!doctype html><html lang="en"><body><pre>${escapeText(
    error instanceof Error ? error.message : String(error),
  )}</pre></body></html>`;
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

function escapeComment(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /-->/g,
    "--\\>",
  );
}
