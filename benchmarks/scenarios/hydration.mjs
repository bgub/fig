import { hydrationRuntimes } from "../lib/host-runtimes.mjs";
import {
  createOperationCounts,
  createScenarioMetrics,
  measureSync,
} from "../lib/timing.mjs";

function measureHydrationLookup(runtime, rows, iterations) {
  const boundaryCount = Math.max(10, rows);
  const { boundaries, target, targetToBoundary } =
    createHydrationLookupFixture(boundaryCount);
  const metrics = createScenarioMetrics();

  const elapsed = measureSync(() => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const boundary =
        runtime.id === "map"
          ? lookupHydrationBoundaryByMap(targetToBoundary, target, metrics)
          : lookupHydrationBoundaryByScan(boundaries, target, metrics);
      if (boundary !== boundaries[boundaries.length - 1]) {
        throw new Error("Hydration lookup found the wrong boundary.");
      }
    }
  });

  return {
    elapsed,
    metrics,
    operations: createOperationCounts(),
  };
}

function createHydrationLookupFixture(boundaryCount) {
  const targetToBoundary = new Map();
  const boundaries = Array.from({ length: boundaryCount }, (_, index) => {
    const target = { id: index };
    const boundary = { end: index + 1, start: index, target };
    targetToBoundary.set(target, boundary);
    return boundary;
  });

  return {
    boundaries,
    target: boundaries[boundaries.length - 1].target,
    targetToBoundary,
  };
}

function lookupHydrationBoundaryByScan(boundaries, target, metrics) {
  for (const boundary of boundaries) {
    metrics.boundaryChecks += 1;
    if (boundary.target === target) return boundary;
  }
  return null;
}

function lookupHydrationBoundaryByMap(targetToBoundary, target, metrics) {
  metrics.boundaryChecks += 1;
  return targetToBoundary.get(target) ?? null;
}

export function hydrationScenariosForRows(rows) {
  return [
    {
      group: "hydration",
      name: "hydration.blocked-boundary-lookup",
      rows,
      measure: (runtime, iterations) =>
        measureHydrationLookup(runtime, rows, iterations),
      runtimes: hydrationRuntimes,
    },
  ];
}
