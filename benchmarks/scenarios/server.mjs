import {
  FigSuspense,
  createFigElement,
  readFigPromise,
  figOnlyRuntime,
} from "../lib/host-runtimes.mjs";
import { renderToHtml as renderFigToHtml } from "../../packages/fig-server/dist/index.js";
import {
  createOperationCounts,
  createScenarioMetrics,
  measureAsync,
} from "../lib/timing.mjs";

async function measureServerSuspenseSiblings(_runtime, rows, iterations) {
  const metrics = createScenarioMetrics();
  const elapsed = await measureAsync(async () => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const gates = [];
      const node = createServerSuspenseFixture(
        Math.max(10, rows),
        gates,
        metrics,
      );
      const html = renderFigToHtml(node);
      for (const gate of gates) gate.resolve(`resolved ${iteration}`);
      const output = await html;
      if (!output.includes("resolved")) {
        throw new Error("Server Suspense benchmark did not resolve content.");
      }
    }
  });

  return {
    elapsed,
    metrics,
    operations: createOperationCounts(),
  };
}

function createServerSuspenseFixture(rows, gates, metrics) {
  return createFigElement(
    "section",
    null,
    Array.from({ length: rows }, (_, index) => {
      if (index % 10 !== 0) {
        return createFigElement("span", { key: index }, `static ${index}`);
      }

      metrics.serverSuspenseBoundaries += 1;
      const gate = createDeferred();
      gates.push(gate);
      return createFigElement(
        FigSuspense,
        {
          fallback: createFigElement("span", null, "loading"),
          key: index,
        },
        createFigElement(ServerAsyncText, { gate }),
      );
    }),
  );
}

function ServerAsyncText({ gate }) {
  return createFigElement("span", null, readFigPromise(gate.promise));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve,
  };
}

export function serverScenariosForRows(rows) {
  return [
    {
      group: "server",
      name: "server.suspense-sibling-streaming",
      rows,
      measure: (runtime, iterations) =>
        measureServerSuspenseSiblings(runtime, rows, iterations),
      runtimes: [figOnlyRuntime],
    },
  ];
}
