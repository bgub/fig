import {
  decodePayloadValue,
  encodePayloadValue,
} from "../../packages/fig-server/dist/payload.js";
import { figOnlyRuntime } from "../lib/host-runtimes.mjs";
import {
  createOperationCounts,
  createScenarioMetrics,
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
  ];
}
