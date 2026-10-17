import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

interface GitFile {
  mode: string;
  content: string;
}

export interface ReleaseChange {
  path: string;
  before?: GitFile;
  after?: GitFile;
}

type CiDecision =
  | { releaseOnly: false; reason: string }
  | { releaseOnly: true; reason: string; versionedPackages: string[] };

interface WorkflowRun {
  id: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
}

interface WorkflowJob {
  name: string;
  status: string;
  conclusion: string | null;
  steps: Array<{ name: string; conclusion: string | null }>;
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function full(reason: string): CiDecision {
  return { releaseOnly: false, reason };
}

/** No source, configuration, new packages, or external dependency changes qualify. */
export function classifyReleaseChanges(
  changes: readonly ReleaseChange[],
  workspaceVersions: ReadonlyMap<string, string>,
): CiDecision {
  const versionedPackages = new Set<string>();
  let publishLockChanged = false;

  for (const { path, before, after } of changes) {
    if ([before, after].some((file) => file && file.mode !== "100644")) {
      return full(`File mode changed or unsupported file type: ${path}`);
    }
    if (path === ".tegami/publish-lock.yaml") {
      if (!after) return full("The publish lock was removed.");
      publishLockChanged = true;
      continue;
    }
    if (/^\.tegami\/[^/]+\.md$/.test(path)) continue;
    if (/^packages\/[^/]+\/CHANGELOG\.md$/.test(path)) continue;

    const npm = /^packages\/[^/]+\/package\.json$/.test(path);
    const jsr = /^packages\/[^/]+\/jsr\.json$/.test(path);
    if ((!npm && !jsr) || !before || !after) {
      return full(`Not an existing release manifest: ${path}`);
    }
    const previous: Record<string, unknown> = JSON.parse(before.content);
    const next: Record<string, unknown> = JSON.parse(after.content);
    if (
      typeof previous.version !== "string" ||
      typeof next.version !== "string"
    ) {
      return full(`Missing package version: ${path}`);
    }
    if (previous.version !== next.version) {
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(next.version)) {
        return full(`Unsupported package version: ${path}`);
      }
      if (npm && previous.private !== true) {
        if (
          typeof previous.name !== "string" ||
          !workspaceVersions.has(previous.name)
        ) {
          return full(`Unknown workspace package: ${path}`);
        }
        versionedPackages.add(`npm:${previous.name}`);
      }
    }
    next.version = previous.version;

    if (npm) {
      for (const field of dependencyFields) {
        if (isDeepStrictEqual(previous[field], next[field])) continue;
        const oldDependencies = previous[field];
        const newDependencies = next[field];
        if (!isRecord(oldDependencies) || !isRecord(newDependencies)) {
          return full(`Dependency fields were added or removed: ${path}`);
        }
        for (const [name, value] of Object.entries(newDependencies)) {
          if (value === oldDependencies[name]) continue;
          const version = workspaceVersions.get(name);
          if (
            !(name in oldDependencies) ||
            version === undefined ||
            typeof value !== "string" ||
            ![version, `^${version}`, `~${version}`].includes(value)
          ) {
            return full(
              `Not an internal version range update: ${path} (${name})`,
            );
          }
          newDependencies[name] = oldDependencies[name];
        }
      }
    }
    if (!isDeepStrictEqual(previous, next)) {
      return full(`Manifest fields other than versions changed: ${path}`);
    }
  }

  if (versionedPackages.size === 0 || !publishLockChanged) {
    return full(
      "Both a public npm version change and an updated publish lock are required.",
    );
  }
  return {
    releaseOnly: true,
    reason: "Only release versions and metadata changed.",
    versionedPackages: [...versionedPackages].sort(),
  };
}

export function isSuccessfulMainRun(run: WorkflowRun, sha: string): boolean {
  return (
    run.head_sha === sha &&
    run.head_branch === "main" &&
    run.event === "push" &&
    run.status === "completed" &&
    run.conclusion === "success"
  );
}

export function hasFullCiJobs(jobs: readonly WorkflowJob[]): boolean {
  return [
    ["checks", "Run pnpm test"],
    ["e2e", "Run pnpm test:e2e"],
  ].every(([name, step]) =>
    jobs.some(
      (job) =>
        job.name === name &&
        job.status === "completed" &&
        job.conclusion === "success" &&
        job.steps.some(
          (item) => item.name === step && item.conclusion === "success",
        ),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function fileAt(ref: string, path: string): GitFile | undefined {
  const entry = git("ls-tree", ref, "--", path).trim();
  if (!entry) return;
  const [mode, , hash] = entry.split(/\s+/);
  return { mode: mode!, content: git("cat-file", "blob", hash!) };
}

export function readReleaseDiff(base: string, head: string): CiDecision {
  git("merge-base", "--is-ancestor", base, head);
  const versions = new Map<string, string>();
  for (const path of git("ls-tree", "-r", "--name-only", "-z", head).split(
    "\0",
  )) {
    if (!/^(apps|packages)\/[^/]+\/package\.json$/.test(path)) continue;
    const manifest = JSON.parse(fileAt(head, path)!.content);
    versions.set(manifest.name, manifest.version);
  }
  const changes = git("diff", "--name-only", "--no-renames", "-z", base, head)
    .split("\0")
    .filter(Boolean)
    .map((path) => ({
      path,
      before: fileAt(base, path),
      after: fileAt(head, path),
    }));
  return classifyReleaseChanges(changes, versions);
}

function github<T>(endpoint: string, parameters: string[] = []): T {
  return JSON.parse(
    execFileSync("gh", ["api", "--method", "GET", endpoint, ...parameters], {
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
}

export function planCi(base: string | undefined, head: string): CiDecision {
  if (
    typeof base !== "string" ||
    !/^[a-f0-9]{40}$/.test(base) ||
    /^0+$/.test(base)
  ) {
    return full("No usable base commit was supplied by the event.");
  }
  try {
    const diff = readReleaseDiff(base, head);
    if (!diff.releaseOnly) return diff;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) return full("No GitHub repository was supplied.");
    const { workflow_runs: runs } = github<{ workflow_runs: WorkflowRun[] }>(
      `repos/${repo}/actions/workflows/ci.yml/runs`,
      [
        "-f",
        `head_sha=${base}`,
        "-f",
        "branch=main",
        "-f",
        "event=push",
        "-f",
        "status=success",
        "-f",
        "per_page=100",
      ],
    );
    for (const run of runs.filter((run) => isSuccessfulMainRun(run, base))) {
      const { jobs } = github<{ jobs: WorkflowJob[] }>(
        `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
      );
      if (hasFullCiJobs(jobs)) {
        return {
          ...diff,
          reason: `${diff.reason} Full main CI passed at ${base}.`,
        };
      }
    }
    return full("The exact base commit has no successful full main CI run.");
  } catch {
    // Missing history, malformed manifests, API failures, and permission errors
    // must never select the shorter path.
    return full(
      "Could not verify the release diff and successful full main CI.",
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : undefined;
  const base =
    process.argv[2] ??
    (process.env.GITHUB_EVENT_NAME === "pull_request"
      ? event?.pull_request?.base?.sha
      : process.env.GITHUB_EVENT_NAME === "push"
        ? event?.before
        : undefined);
  const decision = planCi(base, process.argv[3] ?? "HEAD");
  console.log(
    `${decision.releaseOnly ? "Release validation" : "Full CI"}: ${decision.reason}`,
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `release_only=${decision.releaseOnly}\n`,
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `versioned_packages=${JSON.stringify(decision.releaseOnly ? decision.versionedPackages : [])}\n`,
    );
  }
}
