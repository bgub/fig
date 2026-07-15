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

async function measureServerAttributes(_runtime, rows, iterations) {
  const metrics = createScenarioMetrics();
  const node = createAttributeFixture(rows);
  const expected = attributeFixtureMarkup(rows);
  const elapsed = await measureAsync(async () => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const html = await renderFigToHtml(node);
      if (html !== expected) {
        throw new Error("Attribute-heavy server output changed.");
      }
    }
  });

  return {
    elapsed,
    metrics,
    operations: createOperationCounts(),
  };
}

function createAttributeFixture(rows) {
  return createFigElement(
    "main",
    {
      "aria-label": "Items & <",
      class: "grid",
      "data-count": rows,
      style: {
        "--gap": "1rem",
        display: "grid",
        gridTemplateColumns: "1fr",
      },
    },
    Array.from({ length: rows }, (_, index) =>
      createFigElement(
        "article",
        {
          "aria-label": `Item ${index} & <`,
          class: "card",
          "data-index": index,
          hidden: index % 2 === 0,
          style: {
            "--index": index,
            backgroundColor: "white",
            borderWidth: 1,
          },
          tabindex: 0,
        },
        `Item ${index} & <`,
      ),
    ),
  );
}

function attributeFixtureMarkup(rows) {
  let articles = "";
  for (let index = 0; index < rows; index += 1) {
    const hidden = index % 2 === 0 ? " hidden" : "";
    articles +=
      `<article aria-label="Item ${index} &amp; &lt;" class="card" ` +
      `data-index="${index}"${hidden} ` +
      `style="--index:${index};background-color:white;border-width:1" ` +
      `tabindex="0">Item ${index} &amp; &lt;</article>`;
  }
  return (
    `<main aria-label="Items &amp; &lt;" class="grid" data-count="${rows}" ` +
    `style="--gap:1rem;display:grid;grid-template-columns:1fr">` +
    `${articles}</main>`
  );
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
      name: "server.attribute-heavy",
      rows,
      measure: (runtime, iterations) =>
        measureServerAttributes(runtime, rows, iterations),
      runtimes: [figOnlyRuntime],
    },
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
