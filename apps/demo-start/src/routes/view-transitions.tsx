import { type FigNode, transition, useState, ViewTransition } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { createFileRoute } from "@bgub/fig-start";

export const Route = createFileRoute("/view-transitions")({
  component: ViewTransitionLab,
});

const surfaces = [
  {
    id: "router",
    label: "Route shell",
    metric: "nested",
    note: "Stable layout with changing route content.",
  },
  {
    id: "stream",
    label: "Stream slot",
    metric: "SSR",
    note: "Server content can reveal into an annotated surface.",
  },
  {
    id: "hydration",
    label: "Hydrated island",
    metric: "client",
    note: "Client updates keep a named surface across commits.",
  },
] as const;

function nextSurfaceId(current: string): string {
  const index = surfaces.findIndex((surface) => surface.id === current);
  const next = surfaces[((index === -1 ? 0 : index) + 1) % surfaces.length];
  return next.id;
}

function ViewTransitionLab(): FigNode {
  const [targetId, setTargetId] = useState("router");
  const [dense, setDense] = useState(false);
  const selectedId = targetId;
  const selectedIndex = surfaces.findIndex(
    (surface) => surface.id === selectedId,
  );
  const selected =
    surfaces[selectedIndex === -1 ? 0 : selectedIndex] ?? surfaces[0];
  const ordered = [
    ...surfaces.slice(selectedIndex === -1 ? 0 : selectedIndex),
    ...surfaces.slice(0, selectedIndex === -1 ? 0 : selectedIndex),
  ];

  const cycle = () => {
    transition(() => setTargetId(nextSurfaceId));
  };

  return (
    <section class="space-y-5">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold">
          <ViewTransition
            default="fig-start-route-title"
            enter="none"
            name="start-vt-page-title"
            share="fig-start-route-title"
          >
            <span class="inline-block">View transitions</span>
          </ViewTransition>
        </h1>
        <p class="text-slate-700">
          Fig Start routes can use the same structural `ViewTransition`
          component as client-only and streaming SSR apps.
        </p>
      </header>
      <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <article class="space-y-3 rounded-lg border border-slate-300 bg-white p-5">
          <div class="flex flex-wrap gap-2">
            <button
              class="select-none rounded border border-teal-700 bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
              events={[on("click", cycle)]}
              type="button"
            >
              Cycle surface
            </button>
            <button
              class="rounded border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-50"
              events={[on("click", () => setDense((value) => !value))]}
              type="button"
            >
              Toggle density
            </button>
            <span class="rounded bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700">
              transition commit
            </span>
          </div>
          <div class={dense ? "grid gap-2" : "grid gap-3"}>
            {ordered.map((surface) => (
              <ViewTransition
                default="fig-start-vt"
                enter="none"
                key={surface.id}
                name={`start-vt-${surface.id}`}
                share="fig-start-vt"
                update="fig-start-vt"
              >
                <button
                  class={
                    surface.id === selected.id
                      ? "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-teal-700 bg-teal-50 p-3 text-left text-slate-950"
                      : "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-300 bg-white p-3 text-left text-slate-950 hover:bg-slate-50"
                  }
                  events={[
                    on("click", () =>
                      transition(() => setTargetId(surface.id)),
                    ),
                  ]}
                  type="button"
                >
                  <span class="grid gap-1">
                    <strong>{surface.label}</strong>
                    <span class="text-sm text-slate-500">{surface.note}</span>
                  </span>
                  <span class="rounded bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700">
                    {surface.metric}
                  </span>
                </button>
              </ViewTransition>
            ))}
          </div>
        </article>

        <ViewTransition
          default="fig-start-vt-detail"
          enter="none"
          name="start-vt-detail"
          share="fig-start-vt-detail"
          update="fig-start-vt-detail"
        >
          <aside class="space-y-3 rounded-lg border border-slate-300 bg-white p-5">
            <span class="inline-flex rounded bg-teal-50 px-2 py-1 text-sm font-medium text-teal-800">
              {selected.metric}
            </span>
            <h2 class="text-xl font-semibold">{selected.label}</h2>
            <p class="text-slate-700">{selected.note}</p>
          </aside>
        </ViewTransition>
      </div>
    </section>
  );
}
