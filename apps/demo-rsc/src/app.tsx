import { readPromise, Suspense } from "@bgub/fig";
import { RscBoundary } from "@bgub/fig-server/rsc";
import { feedBoundaryId, RefreshButtonRef } from "./shared.ts";
import { AppFrame } from "./shell.tsx";

interface DemoStats {
  latencyMs: number;
  orders: number;
  region: string;
  revenue: number;
  trend: number;
}

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

export function RscApp({ data }: { data: DemoData }) {
  return (
    <AppFrame
      actions={
        <div className="actions">
          <a className="button" href="/rsc">
            Raw stream
          </a>
          <a className="button" href="/">
            Reload
          </a>
        </div>
      }
      description="Initial render is fetched as an RSC stream; the dashboard can refresh one server-rendered boundary without replacing the app shell."
      title="Server Components"
    >
      <section className="grid">
        <RscBoundary id={feedBoundaryId}>
          <Dashboard data={data} />
        </RscBoundary>
        <Suspense fallback={<InsightPending />}>
          <InsightPanel insight={data.insight} />
        </Suspense>
      </section>
    </AppFrame>
  );
}

export function Dashboard({ data }: { data: DemoData }) {
  return (
    <section className="panel tone-ok dashboard-panel" data-seed={data.seed}>
      <div className="panel-header">
        <div>
          <h2>Regional order pulse</h2>
          <p className="muted">
            Rendered on the server at {data.generatedAt} with seed {data.seed}.
          </p>
        </div>
        <span className="tag ok">boundary</span>
      </div>
      <div className="panel-actions">
        <RefreshButtonRef boundary={feedBoundaryId} seed={data.seed} />
      </div>
      <div className="metric-grid">
        <Metric label="Orders" value={data.stats.orders.toLocaleString()} />
        <Metric
          label="Revenue"
          value={`$${data.stats.revenue.toLocaleString()}`}
        />
        <Metric label="Trend" value={`${data.stats.trend}%`} />
        <Metric label="Latency" value={`${data.stats.latencyMs}ms`} />
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h3>Dispatch region</h3>
          <p className="muted">{data.stats.region}</p>
        </section>
        <section className="panel">
          <h3>Refresh scope</h3>
          <p className="muted">
            The button replaces this boundary with a new server render.
          </p>
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InsightPanel({ insight }: { insight: Promise<string> }) {
  return (
    <section className="panel tone-ok async-panel">
      <div className="panel-header">
        <div>
          <h3>Async server note</h3>
          <p className="muted">{readPromise(insight)}</p>
        </div>
        <span className="tag ok">resolved</span>
      </div>
    </section>
  );
}

function InsightPending() {
  return (
    <section className="panel tone-warn async-panel">
      <div className="panel-header">
        <div>
          <h3>Async server note</h3>
          <p className="muted">Streaming a slower server row.</p>
        </div>
        <span className="tag warn">pending</span>
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

  return `${stats.region} is ${direction} plan with ${stats.orders.toLocaleString()} orders and a ${stats.latencyMs}ms RSC response target.`;
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
