import { lazy, readPromise, Suspense, ViewTransition } from "@bgub/fig";
import { readData } from "@bgub/fig";
import { PayloadBoundary } from "@bgub/fig-server/payload";
import { payloadSummaryResource } from "./data.ts";
import { payloadAuditResource } from "./data.server.ts";
import {
  AppRefreshButtonRef,
  feedBoundaryId,
  noteBoundaryId,
  RefreshButtonRef,
} from "./shared.ts";
import { AppFrame, appDescription } from "./shell.tsx";

interface DemoStats {
  latencyMs: number;
  orders: number;
  region: string;
  revenue: number;
  trend: number;
}

const LazyServerSummary = lazy(() => delay(ServerSummaryPanel, 700));

export function createDemoData(seed: number) {
  const stats = statsFor(seed);

  return {
    generatedAt: new Date().toLocaleTimeString(),
    insight: delay(insightFor(stats), 850),
    seed,
    stats,
  };
}

export type DemoData = ReturnType<typeof createDemoData>;

export function PayloadApp({ data }: { data: DemoData }) {
  return (
    <AppFrame
      actions={
        <div class="actions">
          <a class="button" href="/payload">
            Raw stream
          </a>
          <AppRefreshButtonRef seed={data.seed} />
          <a class="button" href="/">
            Reload page
          </a>
        </div>
      }
      description={appDescription}
      title="Server Components"
    >
      <section class="grid">
        <ViewTransition
          default="payload-dashboard-vt"
          name="payload-dashboard"
          update="payload-dashboard-vt"
        >
          <PayloadBoundary id={feedBoundaryId}>
            <Dashboard data={data} />
          </PayloadBoundary>
        </ViewTransition>
        <ViewTransition
          default="payload-note-vt"
          name="payload-note"
          update="payload-note-vt"
        >
          <PayloadBoundary id={noteBoundaryId}>
            <OperationsNote data={data} />
          </PayloadBoundary>
        </ViewTransition>
        <Suspense fallback={<InsightPending />}>
          <InsightPanel insight={data.insight} />
        </Suspense>
        <Suspense fallback={<LazyServerSummaryPending />}>
          <LazyServerSummary stats={data.stats} />
        </Suspense>
      </section>
    </AppFrame>
  );
}

export function Dashboard({ data }: { data: DemoData }) {
  const summary = readData(payloadSummaryResource, data.seed);
  const audit = readData(payloadAuditResource, data.seed);

  return (
    <section class="panel tone-ok dashboard-panel" data-seed={data.seed}>
      <div class="panel-header">
        <div>
          <h2>Regional order pulse</h2>
          <p class="muted">
            Rendered on the server at {data.generatedAt} with seed {data.seed}.
          </p>
        </div>
        <span class="tag ok">boundary</span>
      </div>
      <div class="panel-actions">
        <RefreshButtonRef
          boundary={feedBoundaryId}
          label="Refresh feed"
          seed={data.seed}
        />
      </div>
      <div class="metric-grid">
        <Metric label="Orders" value={data.stats.orders.toLocaleString()} />
        <Metric
          label="Revenue"
          value={`$${data.stats.revenue.toLocaleString()}`}
        />
        <Metric label="Trend" value={`${data.stats.trend}%`} />
        <Metric label="Latency" value={`${data.stats.latencyMs}ms`} />
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h3>Dispatch region</h3>
          <p class="muted">{data.stats.region}</p>
        </section>
        <section class="panel">
          <h3>Shared data</h3>
          <p class="muted" data-payload-data-kind="isomorphic">
            {summary.source} · {summary.bucket} · load {summary.reads}
          </p>
        </section>
        <section class="panel">
          <h3>Server data</h3>
          <p class="muted" data-payload-data-kind="server-only">
            {audit.source} · request {audit.requestId} · seed {audit.seed}
          </p>
        </section>
        <section class="panel">
          <h3>Refresh scope</h3>
          <p class="muted">
            The button replaces this boundary with a new server render.
          </p>
        </section>
      </div>
    </section>
  );
}

export function OperationsNote({ data }: { data: DemoData }) {
  return (
    <section class="panel async-panel" data-note-seed={data.seed}>
      <div class="panel-header">
        <div>
          <h3>Operations note</h3>
          <p class="muted">
            Server note generated at {data.generatedAt} for {data.stats.region}.
          </p>
        </div>
        <span class="tag">boundary</span>
      </div>
      <div class="panel-actions">
        <RefreshButtonRef
          boundary={noteBoundaryId}
          label="Refresh note"
          seed={data.seed}
        />
      </div>
      <p class="muted">
        Trend {data.stats.trend}% · latency target {data.stats.latencyMs}ms ·
        seed {data.seed}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article class="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InsightPanel({ insight }: { insight: Promise<string> }) {
  return (
    <section class="panel tone-ok async-panel">
      <div class="panel-header">
        <div>
          <h3>Async server note</h3>
          <p class="muted">{readPromise(insight)}</p>
        </div>
        <span class="tag ok">resolved</span>
      </div>
    </section>
  );
}

function InsightPending() {
  return (
    <section class="panel tone-warn async-panel">
      <div class="panel-header">
        <div>
          <h3>Async server note</h3>
          <p class="muted">Streaming a slower server row.</p>
        </div>
        <span class="tag warn">pending</span>
      </div>
    </section>
  );
}

function ServerSummaryPanel({ stats }: { stats: DemoStats }) {
  return (
    <section class="panel tone-ok async-panel">
      <div class="panel-header">
        <div>
          <h3>Lazy server component</h3>
          <p class="muted">
            Loaded with lazy(load), then serialized into the payload stream for{" "}
            {stats.region}.
          </p>
        </div>
        <span class="tag ok">loaded</span>
      </div>
    </section>
  );
}

function LazyServerSummaryPending() {
  return (
    <section class="panel tone-warn async-panel">
      <div class="panel-header">
        <div>
          <h3>Lazy server component</h3>
          <p class="muted">Waiting for the component loader.</p>
        </div>
        <span class="tag warn">lazy</span>
      </div>
    </section>
  );
}

function statsFor(seed: number): DemoStats {
  const normalized = Math.abs(seed);
  const regions = ["Pacific Northwest", "Great Lakes", "Mid-Atlantic", "Gulf"];

  return {
    latencyMs: 42 + (normalized % 47),
    orders: 1100 + ((normalized * 137) % 850),
    region: regions[normalized % regions.length],
    revenue: 68000 + ((normalized * 7919) % 42000),
    trend: 3 + ((normalized * 5) % 19),
  };
}

function insightFor(stats: DemoStats): string {
  const direction = stats.trend > 12 ? "above" : "near";

  return `${stats.region} is ${direction} plan with ${stats.orders.toLocaleString()} orders and a ${stats.latencyMs}ms payload response target.`;
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
