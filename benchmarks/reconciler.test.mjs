import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

describe("bench-reconciler", () => {
  it(
    "writes paired Fig and React runtime results",
    { timeout: 60_000 },
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "fig-bench-"));
      const reportPath = join(tempDir, "report.json");

      try {
        const { stdout } = await execFileAsync(
          "pnpm",
          [
            "bench:reconciler",
            "--rows=4",
            "--samples=1",
            "--target-ms=1",
            "--max-iterations=1",
            `--json=${reportPath}`,
          ],
          {
            cwd: workspaceRoot,
            env: { ...process.env, NODE_ENV: "production" },
            maxBuffer: 1024 * 1024 * 10,
            timeout: 60_000,
          },
        );

        assert.match(stdout, /Fig rows\.initial-mount \(4\)/);
        assert.match(stdout, /React rows\.initial-mount \(4\)/);
        assert.match(stdout, /Fig vs React/);

        const report = JSON.parse(await readFile(reportPath, "utf8"));
        assert.ok(report.metadata.runtimes.includes("fig"));
        assert.ok(report.metadata.runtimes.includes("react"));

        const initialMountRuntimes = report.results
          .filter((result) => result.name === "rows.initial-mount")
          .map((result) => result.runtime)
          .sort();
        assert.deepEqual(initialMountRuntimes, ["fig", "react"]);

        for (const result of report.results) {
          assert.equal(typeof result.runtime, "string");
          assert.equal(typeof result.group, "string");
          assert.equal(typeof result.median, "number");
          assert.equal(typeof result.metricsTotalPerIteration, "number");
          assert.equal(typeof result.operationTotalPerIteration, "number");
        }
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },
  );

  it(
    "can filter benchmark groups and scenarios",
    { timeout: 60_000 },
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "fig-bench-"));
      const reportPath = join(tempDir, "report.json");

      try {
        await execFileAsync(
          "pnpm",
          [
            "bench:reconciler",
            "--group=payload",
            "--scenario=nested",
            "--rows=4",
            "--samples=1",
            "--target-ms=1",
            "--max-iterations=1",
            `--json=${reportPath}`,
          ],
          {
            cwd: workspaceRoot,
            env: { ...process.env, NODE_ENV: "production" },
            maxBuffer: 1024 * 1024 * 10,
            timeout: 60_000,
          },
        );

        const report = JSON.parse(await readFile(reportPath, "utf8"));
        assert.ok(report.results.length > 0);
        assert.ok(report.results.every((result) => result.group === "payload"));
        assert.ok(
          report.results.every((result) =>
            result.name.includes("payload.nested"),
          ),
        );
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },
  );
});
