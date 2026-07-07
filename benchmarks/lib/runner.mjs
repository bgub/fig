import { readFileSync, writeFileSync } from "node:fs";
import {
  createOperationCounts,
  createScenarioMetrics,
  defaultMaxIterations,
  defaultRows,
  defaultSamples,
  defaultTargetMs,
  operationTotal,
} from "./timing.mjs";

async function runScenario(runtime, scenario, options) {
  const warmup = (await scenario.measure(runtime, 1)).elapsed;
  const iterations = benchmarkIterations(
    warmup,
    options.targetMs,
    options.maxIterations,
  );
  const samples = [];
  let metrics = createScenarioMetrics();
  let operations = createOperationCounts();

  for (let index = 0; index < options.samples; index += 1) {
    const result = await scenario.measure(runtime, iterations);
    samples.push(result.elapsed / iterations);
    metrics = result.metrics ?? createScenarioMetrics();
    operations = result.operations;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean =
    samples.reduce((total, sample) => total + sample, 0) / samples.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance =
    samples.reduce((total, sample) => total + (sample - mean) ** 2, 0) /
    samples.length;

  return {
    iterations,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    metrics,
    metricsTotal: operationTotal(metrics),
    metricsTotalPerIteration: operationTotal(metrics) / iterations,
    name: scenario.name,
    operations,
    operationTotal: operationTotal(operations),
    operationTotalPerIteration: operationTotal(operations) / iterations,
    p95: percentile(sorted, 0.95),
    rows: scenario.rows,
    group: scenario.group,
    runtime: runtime.id,
    runtimeLabel: runtime.label,
    samples,
    stddev: Math.sqrt(variance),
  };
}

function benchmarkIterations(warmupMs, targetMs, maxIterations) {
  if (warmupMs <= 0) return maxIterations;
  return Math.min(maxIterations, Math.max(1, Math.ceil(targetMs / warmupMs)));
}

async function run(options, scenariosForRows) {
  const startedAt = new Date().toISOString();
  const results = [];
  const selectedRuntimes = new Set();

  for (const rows of options.rows) {
    for (const scenario of scenariosForRows(rows).filter((candidate) =>
      matchesScenario(candidate, options),
    )) {
      const scenarioRuntimes = scenario.runtimes.filter((runtime) =>
        matchesRuntime(runtime, options),
      );
      if (scenarioRuntimes.length === 0) continue;

      const scenarioResults = [];
      for (const runtime of scenarioRuntimes) {
        const result = await runScenario(runtime, scenario, options);
        results.push(result);
        selectedRuntimes.add(runtime.id);
        printResult(result);
        scenarioResults.push(result);
      }
      printRuntimeComparison(scenarioResults);
    }
  }

  const report = {
    metadata: {
      maxIterations: options.maxIterations,
      node: process.version,
      rows: options.rows,
      groups: options.groups,
      runtimes: [...selectedRuntimes],
      scenarios: options.scenarios,
      samples: options.samples,
      startedAt,
      targetMs: options.targetMs,
      version: 2,
    },
    results,
  };

  if (options.json !== null) {
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${options.json}`);
  }

  if (options.compare !== null) {
    const baseline = JSON.parse(readFileSync(options.compare, "utf8"));
    const failed = printComparison(baseline, report, options.thresholdPct);
    if (failed) process.exitCode = 1;
  }

  return report;
}

function matchesScenario(scenario, options) {
  const groupMatches =
    options.groups.length === 0 || options.groups.includes(scenario.group);
  const scenarioMatches =
    options.scenarios.length === 0 ||
    options.scenarios.some(
      (pattern) =>
        scenario.name.includes(pattern) || scenario.group.includes(pattern),
    );

  return groupMatches && scenarioMatches;
}

function matchesRuntime(runtime, options) {
  return options.runtimes.length === 0 || options.runtimes.includes(runtime.id);
}

function printResult(result) {
  const name = `${result.runtimeLabel} ${result.name} (${result.rows})`;
  const stats = [
    `median ${formatMs(result.median)}`,
    `mean ${formatMs(result.mean)}`,
    `p95 ${formatMs(result.p95)}`,
    `x${result.iterations}/sample`,
    `${formatNumber(result.operationTotalPerIteration)} ops/iter`,
  ];
  if (result.metricsTotalPerIteration > 0) {
    stats.push(`${formatNumber(result.metricsTotalPerIteration)} metrics/iter`);
  }
  console.log(`${name.padEnd(50)} ${stats.join(" · ")}`);
}

function printRuntimeComparison(results) {
  const figResult = results.find((result) => result.runtime === "fig");
  const reactResult = results.find((result) => result.runtime === "react");
  if (figResult === undefined || reactResult === undefined) return;

  const medianDeltaPct =
    ((figResult.median - reactResult.median) / reactResult.median) * 100;
  const operationDeltaPct =
    ((figResult.operationTotalPerIteration -
      reactResult.operationTotalPerIteration) /
      reactResult.operationTotalPerIteration) *
    100;
  console.log(
    `${"Fig vs React".padEnd(50)} median ${formatPct(
      medianDeltaPct,
    )} · ops/iter ${formatPct(operationDeltaPct)}\n`,
  );
}

function printComparison(baseline, current, thresholdPct) {
  const baselineResults = new Map();
  for (const result of baseline.results ?? []) {
    baselineResults.set(resultKey(result), result);
  }

  let failed = false;
  console.log(
    `\nComparison against ${baseline.metadata?.startedAt ?? "baseline"}`,
  );
  console.log(
    `${"scenario".padEnd(50)} ${"base".padStart(10)} ${"current".padStart(
      10,
    )} ${"delta".padStart(10)} status`,
  );

  for (const result of current.results) {
    const baselineResult =
      baselineResults.get(resultKey(result)) ??
      (result.runtime === "fig"
        ? baselineResults.get(legacyResultKey(result))
        : undefined);
    if (baselineResult === undefined) {
      console.log(
        `${resultLabel(result).padEnd(50)} ${"n/a".padStart(10)} ${formatMs(
          result.median,
        ).padStart(10)} ${"n/a".padStart(10)} new`,
      );
      continue;
    }

    const deltaPct =
      ((result.median - baselineResult.median) / baselineResult.median) * 100;
    const status = deltaPct > thresholdPct ? "regression" : "ok";
    if (status === "regression") failed = true;
    console.log(
      `${resultLabel(result).padEnd(50)} ${formatMs(
        baselineResult.median,
      ).padStart(10)} ${formatMs(result.median).padStart(10)} ${formatPct(
        deltaPct,
      ).padStart(10)} ${status}`,
    );
  }

  if (failed) {
    console.error(
      `\nOne or more scenarios exceeded --threshold-pct=${thresholdPct}.`,
    );
  }

  return failed;
}

function resultKey(result) {
  return `${result.runtime}:${result.name}:${result.rows}`;
}

function legacyResultKey(result) {
  return `undefined:${result.name}:${result.rows}`;
}

function resultLabel(result) {
  return `${result.runtimeLabel ?? result.runtime} ${result.name} (${
    result.rows
  })`;
}

function percentile(sorted, percentileValue) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

function formatMs(value) {
  if (value < 1) return `${(value * 1000).toFixed(1)}us`;
  return `${value.toFixed(2)}ms`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function parseArgs(argv) {
  const options = {
    compare: null,
    groups: [],
    json: null,
    maxIterations: defaultMaxIterations,
    rows: defaultRows,
    runtimes: [],
    scenarios: [],
    samples: defaultSamples,
    targetMs: defaultTargetMs,
    thresholdPct: 10,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--rows=")) {
      options.rows = numberList(arg.slice("--rows=".length), "--rows");
      continue;
    }
    if (arg.startsWith("--group=")) {
      options.groups = stringList(arg.slice("--group=".length), "--group");
      continue;
    }
    if (arg.startsWith("--scenario=")) {
      options.scenarios = stringList(
        arg.slice("--scenario=".length),
        "--scenario",
      );
      continue;
    }
    if (arg.startsWith("--runtime=")) {
      options.runtimes = stringList(
        arg.slice("--runtime=".length),
        "--runtime",
      );
      continue;
    }
    if (arg.startsWith("--samples=")) {
      options.samples = positiveInteger(arg.slice("--samples=".length), arg);
      continue;
    }
    if (arg.startsWith("--target-ms=")) {
      options.targetMs = positiveNumber(arg.slice("--target-ms=".length), arg);
      continue;
    }
    if (arg.startsWith("--max-iterations=")) {
      options.maxIterations = positiveInteger(
        arg.slice("--max-iterations=".length),
        arg,
      );
      continue;
    }
    if (arg.startsWith("--json=")) {
      options.json = arg.slice("--json=".length);
      continue;
    }
    if (arg.startsWith("--compare=")) {
      options.compare = arg.slice("--compare=".length);
      continue;
    }
    if (arg.startsWith("--threshold-pct=")) {
      options.thresholdPct = positiveNumber(
        arg.slice("--threshold-pct=".length),
        arg,
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function numberList(value, label) {
  const parsed = value.split(",").map((item) => positiveInteger(item, label));
  if (parsed.length === 0) throw new Error(`${label} must not be empty.`);
  return parsed;
}

function stringList(value, label) {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (parsed.length === 0) throw new Error(`${label} must not be empty.`);
  return parsed;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: pnpm bench:reconciler [options]

Runs the Fig and React reconciler scenario matrix against in-memory hosts.

Options:
  --rows=100,1000          Comma-separated benchmark sizes.
  --group=name             Comma-separated groups: reconciler, context,
                           external-store, commit, suspense, hydration,
                           payload, server.
  --scenario=name          Comma-separated scenario/group substrings.
  --runtime=name           Comma-separated runtimes: fig, react, scan, map.
  --samples=7              Timed samples per scenario.
  --target-ms=50           Target milliseconds per sample.
  --max-iterations=80      Maximum iterations per sample.
  --json=path              Write machine-readable JSON.
  --compare=path           Compare medians against a previous JSON report.
  --threshold-pct=10       Fail when current median is this much slower.

For lower GC noise, run with:
  node --expose-gc scripts/bench-reconciler.mjs
`);
}

export async function runBenchmarkSuite(argv, scenariosForRows) {
  try {
    await run(parseArgs(argv), scenariosForRows);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
