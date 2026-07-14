import {
  decodePayloadValue,
  encodePayloadValue,
} from "../../packages/fig/dist/internal.js";
import { decodePayloadStream } from "../../packages/fig/dist/payload.js";
import { renderToPayloadStream } from "../../packages/fig-server/dist/payload.js";
import {
  BenchElement,
  clientRuntimes,
  createFigElement,
  figOnlyRuntime,
} from "../lib/host-runtimes.mjs";
import {
  createOperationCounts,
  createScenarioMetrics,
  measureAsync,
  measureSync,
} from "../lib/timing.mjs";

function measurePayloadNestedContainers(_runtime, rows, iterations) {
  const metrics = createScenarioMetrics();
  const value = createPayloadFixture(Math.max(10, rows), metrics);

  const elapsed = measureSync(() => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const model = encodePayloadValue(value);
      const decoded = decodePayloadValue(model);
      if (!(decoded instanceof Map)) {
        throw new Error("Payload decode did not preserve the top-level Map.");
      }
    }
  });

  return {
    elapsed,
    metrics,
    operations: createOperationCounts(),
  };
}

function createPayloadFixture(rows, metrics) {
  const shared = { kind: "shared", values: [1, 2, 3] };
  const root = new Map();
  const cyclic = { name: "cycle", self: null };
  cyclic.self = cyclic;

  root.set("shared-a", shared);
  root.set("shared-b", shared);
  root.set("cycle", cyclic);
  for (let index = 0; index < rows; index += 1) {
    metrics.payloadNodes += 1;
    root.set(
      { index },
      new Set([
        shared,
        { index, nested: [index, index + 1, { shared }] },
        Symbol.for(`fig.bench.${index % 8}`),
      ]),
    );
  }

  return root;
}

// ---------------------------------------------------------------------------
// Refresh reconciliation (docs/plans/serialized-components.md, phase 3): each
// refresh re-decodes the whole value into fresh element objects, so the
// reconciler runs ordinary keyed diffing over the full document. The deleted
// legacy consumer's targeted-refresh numbers are recorded in the plan as the
// historical baseline these stay comparable to.

// A "document": `rows` static article sections plus one small dynamic note
// that a refresh replaces.
function documentNode(rows, revision) {
  return createFigElement(
    "main",
    null,
    Array.from({ length: rows }, (_, index) =>
      createFigElement(
        "article",
        { key: `section-${index}`, class: "section" },
        createFigElement("h2", null, `Section ${index}`),
        createFigElement(
          "ul",
          null,
          Array.from({ length: 10 }, (_, item) =>
            createFigElement(
              "li",
              {
                key: `item-${item}`,
                class: item % 2 === 0 ? "even" : "odd",
                "data-index": String(item),
              },
              `Item ${index}.${item}`,
            ),
          ),
        ),
      ),
    ),
    createFigElement("p", { class: "note" }, `revision ${revision}`),
  );
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function renderToPayloadText(node, options) {
  const result = renderToPayloadStream(node, options);
  await result.allReady;
  return streamToText(result.stream);
}

function streamFromText(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// Resource model: each refresh re-decodes the whole document into fresh
// elements and renders the new root over the old — ordinary keyed
// reconciliation with no identity bailouts.
async function measureResourceRefresh(runtime, rows, iterations) {
  const metrics = createScenarioMetrics();
  const texts = [
    await renderToPayloadText(documentNode(rows, 1)),
    await renderToPayloadText(documentNode(rows, 2)),
  ];
  const initial = decodePayloadStream(
    streamFromText(await renderToPayloadText(documentNode(rows, 0))),
  );
  const initialValue = await initial.value;

  const { flushSync, operations, createRoot, container } =
    createFigBenchRootFor(runtime);
  const root = createRoot(container);
  flushSync(() => root.render(initialValue));
  assertRendered(container, "revision 0");

  const elapsed = await measureAsync(async () => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const decode = decodePayloadStream(streamFromText(texts[iteration % 2]));
      const value = await decode.value;
      flushSync(() => root.render(value));
      metrics.payloadNodes += 1;
    }
  });
  assertRendered(container, "revision ");

  return { elapsed, metrics, operations };
}

// Decode-only decomposition: the resource-model iteration cost minus this is
// the pure reconciliation cost of fresh-element keyed diffing.
async function measureResourceDecodeOnly(_runtime, rows, iterations) {
  const metrics = createScenarioMetrics();
  const texts = [
    await renderToPayloadText(documentNode(rows, 1)),
    await renderToPayloadText(documentNode(rows, 2)),
  ];

  const elapsed = await measureAsync(async () => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const decode = decodePayloadStream(streamFromText(texts[iteration % 2]));
      const value = await decode.value;
      if (value === null) throw new Error("Payload decode produced no root.");
      metrics.payloadNodes += 1;
    }
  });

  return { elapsed, metrics, operations: createOperationCounts() };
}

const figClientRuntime = clientRuntimes.find((entry) => entry.id === "fig");

function createFigBenchRootFor(runtime) {
  const renderer = runtime.createRenderer();
  return {
    container: new BenchElement("root"),
    createRoot: renderer.createRoot,
    flushSync: renderer.flushSync,
    operations: renderer.operations,
  };
}

function assertRendered(container, needle) {
  if (!container.textContent.includes(needle)) {
    throw new Error(`Payload refresh benchmark did not render "${needle}".`);
  }
}

export function payloadScenariosForRows(rows) {
  return [
    {
      group: "payload",
      name: "payload.nested-containers",
      rows,
      measure: (runtime, iterations) =>
        measurePayloadNestedContainers(runtime, rows, iterations),
      runtimes: [figOnlyRuntime],
    },
    {
      group: "payload",
      name: "payload.refresh-resource",
      rows,
      measure: (runtime, iterations) =>
        measureResourceRefresh(runtime, rows, iterations),
      runtimes: [figClientRuntime],
    },
    {
      group: "payload",
      name: "payload.refresh-resource-decode-only",
      rows,
      measure: (runtime, iterations) =>
        measureResourceDecodeOnly(runtime, rows, iterations),
      runtimes: [figOnlyRuntime],
    },
  ];
}
