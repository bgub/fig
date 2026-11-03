import {
  dataResource,
  type FigNode,
  readData,
  Suspense,
  useState,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { createFileRoute } from "@tanstack/solid-router";
import { delay } from "../posts.ts";

export const Route = createFileRoute("/streaming")({
  component: StreamingLab,
  head: () => ({ meta: [{ title: "Streaming · Fig TanStack Start" }] }),
});

// Server-only delays: the browser must adopt the streamed values, so a client
// load shows up as a "browser" source in the rendered text.
const streamedValueResource = dataResource<[string, number], string>({
  key: (name) => ["streamed-value", name],
  load: async (name, delayMs) => {
    if (typeof document !== "undefined") return `${name} · browser`;
    await delay(delayMs);
    return `${name} · server`;
  },
});

function StreamingLab(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">Streaming</h1>
      <Suspense fallback={<p data-streamed="fast">Fast pending</p>}>
        <StreamedPanel delayMs={50} name="fast" />
      </Suspense>
      <Suspense fallback={<p data-streamed="slow">Slow pending</p>}>
        <StreamedPanel delayMs={2500} name="slow" />
      </Suspense>
    </section>
  );
}

function StreamedPanel(props: { delayMs: number; name: string }): FigNode {
  const value = readData(streamedValueResource, props.name, props.delayMs);
  const [clicks, setClicks] = useState(0);
  return (
    <div class="flex items-center gap-3" data-streamed={props.name}>
      <span>{value}</span>
      <button
        class="rounded border px-2"
        mix={on("click", () => setClicks((count) => count + 1))}
        type="button"
      >
        {`${props.name} clicks ${clicks}`}
      </button>
    </div>
  );
}
