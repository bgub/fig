import { type FigNode, Suspense } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { readData, readDataStore } from "@bgub/fig-data";
import { createFileRoute, Link } from "@bgub/fig-start";
import { postSummaryResource } from "../data.ts";
import { remotePostStatusResource } from "../data.server.ts";

export const Route = createFileRoute("/data")({
  component: DataLab,
});

function DataLab(): FigNode {
  return (
    <section class="space-y-5">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight">Data lab</h1>
        <p class="text-slate-700">
          This route reads an isomorphic resource and a server resource with
          remote refresh from a client-routable page.
        </p>
      </header>
      <div class="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<DataCard title="Isomorphic" value="Loading" />}>
          <IsomorphicPanel />
        </Suspense>
        <Suspense fallback={<DataCard title="Remote server" value="Loading" />}>
          <RemotePanel />
        </Suspense>
      </div>
      <p>
        <Link class="font-medium text-teal-700" to="/posts/1">
          Open server-only post payload
        </Link>
      </p>
    </section>
  );
}

function IsomorphicPanel(): FigNode {
  const data = readDataStore();
  const summary = readData(postSummaryResource, "1");

  return (
    <DataCard
      action="Refresh isomorphic"
      onAction={() => void data.refreshData(postSummaryResource, "1")}
      title="Isomorphic"
      value={`${summary.title} · ${summary.source} · load ${summary.loadCount}`}
    />
  );
}

function RemotePanel(): FigNode {
  const data = readDataStore();
  const status = readData(remotePostStatusResource, "2");

  return (
    <DataCard
      action="Refresh remote"
      onAction={() => void data.refreshData(remotePostStatusResource, "2")}
      title="Remote server"
      value={`${status.title} · ${status.source} · load ${status.refreshCount}`}
    />
  );
}

function DataCard(props: {
  action?: string;
  onAction?: () => void;
  title: string;
  value: string;
}): FigNode {
  return (
    <article class="space-y-3 rounded-lg border border-slate-300 bg-white p-5">
      <h2 class="text-xl font-semibold tracking-tight">{props.title}</h2>
      <p class="text-slate-700" data-data-value={props.title}>
        {props.value}
      </p>
      {props.action === undefined || props.onAction === undefined ? null : (
        <button
          class="rounded border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-50"
          events={[on("click", props.onAction)]}
        >
          {props.action}
        </button>
      )}
    </article>
  );
}
