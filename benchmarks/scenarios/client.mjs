import { BenchElement, clientRuntimes } from "../lib/host-runtimes.mjs";
import {
  createScenarioMetrics,
  measureSync,
  resetMetrics,
  resetOperations,
  snapshotMetrics,
  snapshotOperations,
} from "../lib/timing.mjs";

const runtimes = clientRuntimes.map((runtime) => ({
  ...runtime,
  components: createBenchmarkComponents(runtime),
}));

const neverResolves = new Promise(() => undefined);

function createBenchmarkComponents(runtime) {
  const ThemeContext = runtime.createContext("default");
  const state = {
    deepLeafSetters: [],
    externalStoreLeafSetters: [],
    metrics: createScenarioMetrics(),
    providerLeafSetters: [],
  };

  function Rows({
    count,
    label = "Row",
    reverse = false,
    start = 0,
    version = 0,
  }) {
    return runtime.createElement(
      "ul",
      null,
      rowIds(count, start, reverse).map((id) =>
        runtime.createElement(
          "li",
          { key: id },
          runtime.createElement("span", null, `${label} ${id}`),
          runtime.createElement("span", null, `v${version}`),
        ),
      ),
    );
  }

  function ProviderLeaf() {
    state.metrics.componentRenders += 1;
    const theme = runtime.readContext(ThemeContext);
    state.metrics.contextReads += 1;
    const [version, setVersion] = runtime.useState(0);
    state.providerLeafSetters.push(setVersion);

    return runtime.createElement("span", null, `${theme}:${version}`);
  }

  function ProviderTree({ width }) {
    return runtime.createElement(
      runtime.providerFor(ThemeContext),
      { value: "provided" },
      runtime.createElement(
        "section",
        null,
        Array.from({ length: width }, (_, index) =>
          index === width - 1
            ? runtime.createElement(ProviderLeaf, { key: index })
            : runtime.createElement("span", { key: index }, `static ${index}`),
        ),
      ),
    );
  }

  function DeepTree({ depth, fanout }) {
    state.metrics.componentRenders += 1;
    const [version, setVersion] = runtime.useState(0);
    state.deepLeafSetters.push(setVersion);

    return runtime.createElement(
      "main",
      null,
      createDeepChildren(runtime.createElement, depth, fanout, version, "r"),
    );
  }

  function SparseContextConsumer() {
    state.metrics.componentRenders += 1;
    state.metrics.contextReads += 1;
    const value = runtime.readContext(ThemeContext);
    return runtime.createElement("span", null, value);
  }

  function SparseContextTree({ width, value }) {
    return runtime.createElement(
      runtime.providerFor(ThemeContext),
      { value },
      runtime.createElement(
        "section",
        null,
        Array.from({ length: width }, (_, index) => {
          if (index % 20 === 0) {
            return runtime.createElement(SparseContextConsumer, { key: index });
          }
          if (index % 47 === 0) {
            return runtime.createElement(
              runtime.providerFor(ThemeContext),
              { key: index, value: "nested" },
              runtime.createElement(SparseContextConsumer, null),
            );
          }
          return runtime.createElement(
            "span",
            { key: index },
            `static ${index}`,
          );
        }),
      ),
    );
  }

  function ExternalStoreConsumer({ store }) {
    state.metrics.componentRenders += 1;
    state.metrics.externalStoreReads += 1;
    const value = runtime.useExternalStore(store.subscribe, store.getSnapshot);
    return runtime.createElement("span", null, value);
  }

  function ExternalStoreTree({ store, width }) {
    return runtime.createElement(
      "section",
      null,
      Array.from({ length: width }, (_, index) =>
        index % 10 === 0
          ? runtime.createElement(ExternalStoreConsumer, { key: index, store })
          : runtime.createElement("span", { key: index }, `static ${index}`),
      ),
    );
  }

  function ExternalStoreStateLeaf() {
    state.metrics.componentRenders += 1;
    const [version, setVersion] = runtime.useState(0);
    state.externalStoreLeafSetters.push(setVersion);
    return runtime.createElement("strong", null, `leaf ${version}`);
  }

  function ExternalStoreUnrelatedUpdateTree({ store, width }) {
    return runtime.createElement(
      "section",
      null,
      runtime.createElement(
        "div",
        null,
        Array.from({ length: width }, (_, index) =>
          runtime.createElement(ExternalStoreConsumer, { key: index, store }),
        ),
      ),
      runtime.createElement(ExternalStoreStateLeaf, null),
    );
  }

  function SparseLeaf() {
    state.metrics.componentRenders += 1;
    const [version, setVersion] = runtime.useState(0);
    state.deepLeafSetters.push(setVersion);
    return runtime.createElement("span", null, `leaf ${version}`);
  }

  function SparseCommitTree({ width }) {
    return runtime.createElement(
      "section",
      null,
      Array.from({ length: width }, (_, index) =>
        index === width - 1
          ? runtime.createElement(SparseLeaf, { key: index })
          : runtime.createElement("span", { key: index }, `static ${index}`),
      ),
    );
  }

  function SuspenseMaybeSuspend({ suspend, promise }) {
    state.metrics.componentRenders += 1;
    if (suspend) runtime.readPromise(promise);
    return runtime.createElement("span", null, "ready");
  }

  function SuspenseSiblingTree({ suspend, suspendedIndex, width }) {
    return runtime.createElement(
      "section",
      null,
      Array.from({ length: width }, (_, index) =>
        runtime.createElement(
          runtime.Suspense,
          {
            fallback: runtime.createElement("span", null, "loading"),
            key: index,
          },
          runtime.createElement(SuspenseMaybeSuspend, {
            promise: neverResolves,
            suspend: suspend && index === suspendedIndex,
          }),
        ),
      ),
    );
  }

  return {
    DeepTree,
    ExternalStoreUnrelatedUpdateTree,
    ExternalStoreTree,
    ProviderTree,
    Rows,
    SparseCommitTree,
    SparseContextTree,
    SuspenseSiblingTree,
    state,
  };
}

function createDeepChildren(createElement, depth, fanout, version, prefix) {
  if (depth === 0) {
    return createElement("span", null, `leaf ${version}`);
  }

  return Array.from({ length: fanout }, (_, index) =>
    createElement(
      "section",
      { key: `${prefix}-${index}` },
      index === fanout - 1
        ? createDeepChildren(
            createElement,
            depth - 1,
            fanout,
            version,
            `${prefix}-${index}`,
          )
        : createStaticSubtree(
            createElement,
            depth - 1,
            fanout,
            `${prefix}-${index}`,
          ),
    ),
  );
}

function createStaticSubtree(createElement, depth, fanout, prefix) {
  if (depth === 0) return createElement("span", null, `static ${prefix}`);

  return Array.from({ length: fanout }, (_, index) =>
    createElement(
      "section",
      { key: `${prefix}-${index}` },
      createStaticSubtree(
        createElement,
        depth - 1,
        fanout,
        `${prefix}-${index}`,
      ),
    ),
  );
}

function rowIds(count, start, reverse) {
  const ids = [];
  for (let index = 0; index < count; index += 1) ids.push(start + index);
  if (reverse) ids.reverse();
  return ids;
}

function createRoot(renderer) {
  const container = new BenchElement("root");
  return {
    container,
    root: renderer.createRoot(container),
  };
}

function cleanup(renderer, roots) {
  renderer.flushSync(() => {
    for (const { root } of roots) root.unmount();
  });
}

function measureWithRoots(
  runtime,
  iterations,
  { beforeMeasure, setup, run, validate },
) {
  const renderer = runtime.createRenderer();
  const roots = Array.from({ length: iterations }, () => createRoot(renderer));
  resetMetrics(runtime.components.state.metrics);

  if (setup !== undefined) {
    renderer.flushSync(() => {
      setup(roots);
    });
  }

  beforeMeasure?.();
  resetOperations(renderer.operations);
  resetMetrics(runtime.components.state.metrics);
  const elapsed = measureSync(() => {
    renderer.flushSync(() => {
      run(roots);
    });
  });

  validate?.(roots);

  const metrics = snapshotMetrics(runtime.components.state.metrics);
  const operations = snapshotOperations(renderer.operations);
  cleanup(renderer, roots);
  return { elapsed, metrics, operations };
}

function renderAll(runtime, roots, Component, props) {
  for (const { root } of roots) {
    root.render(runtime.createElement(Component, props));
  }
}

function incrementAll(setters) {
  for (const setter of setters) {
    setter((version) => version + 1);
  }
}

function createExternalStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  const metrics = createScenarioMetrics();

  return {
    get metrics() {
      return metrics;
    },
    getSnapshot: () => {
      metrics.externalStoreSnapshotReads += 1;
      return value;
    },
    set: (nextValue) => {
      value = nextValue;
      metrics.storeNotifications += listeners.size;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function measureRowsInitialMount(runtime, rows, iterations) {
  return measureWithRoots(runtime, iterations, {
    run: (roots) =>
      renderAll(runtime, roots, runtime.components.Rows, {
        count: rows,
        version: 1,
      }),
  });
}

function measureRowsUpdate(
  runtime,
  rows,
  iterations,
  previousProps,
  nextProps,
) {
  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.Rows, previousProps),
    run: (roots) =>
      renderAll(runtime, roots, runtime.components.Rows, nextProps),
  });
}

function measureDeepLeafUpdate(runtime, rows, iterations) {
  runtime.components.state.deepLeafSetters = [];

  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(
        runtime,
        roots,
        runtime.components.DeepTree,
        deepTreeShape(rows),
      ),
    run: () => incrementAll(runtime.components.state.deepLeafSetters),
  });
}

function measureStableProviderChildUpdate(runtime, rows, iterations) {
  runtime.components.state.providerLeafSetters = [];

  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.ProviderTree, {
        width: Math.max(10, rows),
      }),
    run: () => incrementAll(runtime.components.state.providerLeafSetters),
    validate: assertProviderChildUpdate,
  });
}

function measureSparseContextUpdate(runtime, rows, iterations) {
  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.SparseContextTree, {
        value: "first",
        width: Math.max(20, rows),
      }),
    run: (roots) =>
      renderAll(runtime, roots, runtime.components.SparseContextTree, {
        value: "second",
        width: Math.max(20, rows),
      }),
  });
}

function measureExternalStoreUpdate(runtime, rows, iterations) {
  const store = createExternalStore(0);
  const result = measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.ExternalStoreTree, {
        store,
        width: Math.max(20, rows),
      }),
    run: () => store.set(1),
    beforeMeasure: () => resetMetrics(store.metrics),
  });

  result.metrics.storeNotifications = store.metrics.storeNotifications;
  result.metrics.externalStoreSnapshotReads =
    store.metrics.externalStoreSnapshotReads;
  return result;
}

function measureExternalStoreUnrelatedUpdate(runtime, rows, iterations) {
  runtime.components.state.externalStoreLeafSetters = [];
  const store = createExternalStore(0);

  const result = measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(
        runtime,
        roots,
        runtime.components.ExternalStoreUnrelatedUpdateTree,
        {
          store,
          width: Math.max(20, rows),
        },
      ),
    run: () => incrementAll(runtime.components.state.externalStoreLeafSetters),
    beforeMeasure: () => resetMetrics(store.metrics),
  });

  result.metrics.externalStoreSnapshotReads =
    store.metrics.externalStoreSnapshotReads;
  return result;
}

function measureSparseCommitLeafUpdate(runtime, rows, iterations) {
  runtime.components.state.deepLeafSetters = [];

  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.SparseCommitTree, {
        width: Math.max(20, rows),
      }),
    run: () => incrementAll(runtime.components.state.deepLeafSetters),
  });
}

function measureSuspenseReveal(runtime, rows, iterations) {
  return measureWithRoots(runtime, iterations, {
    setup: (roots) =>
      renderAll(runtime, roots, runtime.components.SuspenseSiblingTree, {
        suspend: true,
        suspendedIndex: Math.max(0, Math.min(rows - 1, rows >> 1)),
        width: Math.max(10, rows),
      }),
    run: (roots) =>
      renderAll(runtime, roots, runtime.components.SuspenseSiblingTree, {
        suspend: false,
        suspendedIndex: Math.max(0, Math.min(rows - 1, rows >> 1)),
        width: Math.max(10, rows),
      }),
  });
}

function assertProviderChildUpdate(roots) {
  for (const { container } of roots) {
    const text = container.textContent;
    if (!text.endsWith("provided:1")) {
      throw new Error(
        `Stable provider child update read stale context: ${JSON.stringify(
          text.slice(-40),
        )}`,
      );
    }
  }
}

function deepTreeShape(rows) {
  if (rows <= 100) return { depth: 3, fanout: 4 };
  if (rows <= 1000) return { depth: 4, fanout: 5 };
  return { depth: 5, fanout: 5 };
}

export function clientScenariosForRows(rows) {
  const appendCount = Math.max(1, Math.round(rows * 0.1));

  return [
    {
      group: "reconciler",
      name: "rows.initial-mount",
      rows,
      measure: (runtime, iterations) =>
        measureRowsInitialMount(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "reconciler",
      name: "rows.same-order-update",
      rows,
      measure: (runtime, iterations) =>
        measureRowsUpdate(
          runtime,
          rows,
          iterations,
          { count: rows, version: 1 },
          { count: rows, version: 2 },
        ),
      runtimes,
    },
    {
      group: "reconciler",
      name: "rows.append-10pct",
      rows,
      measure: (runtime, iterations) =>
        measureRowsUpdate(
          runtime,
          rows,
          iterations,
          { count: rows },
          { count: rows + appendCount },
        ),
      runtimes,
    },
    {
      group: "reconciler",
      name: "rows.prepend-10pct",
      rows,
      measure: (runtime, iterations) =>
        measureRowsUpdate(
          runtime,
          rows,
          iterations,
          { count: rows },
          { count: rows + appendCount, start: -appendCount },
        ),
      runtimes,
    },
    {
      group: "reconciler",
      name: "rows.reverse-keyed",
      rows,
      measure: (runtime, iterations) =>
        measureRowsUpdate(
          runtime,
          rows,
          iterations,
          { count: rows },
          { count: rows, reverse: true },
        ),
      runtimes,
    },
    {
      group: "reconciler",
      name: "tree.deep-leaf-state-update",
      rows,
      measure: (runtime, iterations) =>
        measureDeepLeafUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "reconciler",
      name: "context.stable-provider-child-update",
      rows,
      measure: (runtime, iterations) =>
        measureStableProviderChildUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "context",
      name: "context.sparse-provider-update",
      rows,
      measure: (runtime, iterations) =>
        measureSparseContextUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "external-store",
      name: "external-store.sparse-subscribers-update",
      rows,
      measure: (runtime, iterations) =>
        measureExternalStoreUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "external-store",
      name: "external-store.dense-subscribers-unrelated-update",
      rows,
      measure: (runtime, iterations) =>
        measureExternalStoreUnrelatedUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "commit",
      name: "commit.sparse-leaf-state-update",
      rows,
      measure: (runtime, iterations) =>
        measureSparseCommitLeafUpdate(runtime, rows, iterations),
      runtimes,
    },
    {
      group: "suspense",
      name: "suspense.sibling-reveal",
      rows,
      measure: (runtime, iterations) =>
        measureSuspenseReveal(runtime, rows, iterations),
      runtimes,
    },
  ];
}
