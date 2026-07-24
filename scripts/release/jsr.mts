import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Draft, PublishPlan, TegamiPlugin } from "tegami";

interface JsrManifest {
  name: string;
  version: string;
  [key: string]: unknown;
}

type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<void>;

interface JsrReleaseOptions {
  fetch?: typeof fetch;
  publishOrder?: readonly string[];
  run?: CommandRunner;
}

export function jsrRelease(options: JsrReleaseOptions = {}): TegamiPlugin {
  const fetchRegistry = options.fetch ?? fetch;
  const publishOrder = options.publishOrder ?? [];
  const run = options.run ?? runCommand;

  return {
    name: "jsr",
    enforce: "post",

    async applyDraft(draft) {
      await synchronizeDraftManifests(draft, this.graph.getPackages());
    },

    beforePublishAll: async function ({ plan }) {
      const packages = publishablePackages(plan).sort(
        ([leftId], [rightId]) =>
          orderOf(this.graph.get(leftId)?.name, publishOrder) -
          orderOf(this.graph.get(rightId)?.name, publishOrder),
      );

      for (const [id] of packages) {
        const pkg = this.graph.get(id);
        if (pkg?.version === undefined) continue;

        const manifestPath = join(pkg.path, "jsr.json");
        const manifest = await readJsrManifest(manifestPath);
        if (manifest === undefined) continue;
        assertManifestIdentity(manifest, pkg.name, pkg.version, manifestPath);

        if (await isJsrVersionPublished(pkg.name, pkg.version, fetchRegistry)) {
          continue;
        }

        const args = ["exec", "jsr", "publish"];
        if (plan.options.dryRun === true) args.push("--dry-run");
        await run("pnpm", args, pkg.path);
      }
    },

    resolvePlanStatus: function ({ plan }) {
      return Array.from(publishablePackages(plan), async ([id]) => {
        const pkg = this.graph.get(id);
        if (pkg?.version === undefined) return;
        if ((await readJsrManifest(join(pkg.path, "jsr.json"))) === undefined) {
          return;
        }

        return (await isJsrVersionPublished(
          pkg.name,
          pkg.version,
          fetchRegistry,
        ))
          ? "success"
          : "pending";
      });
    },
  };
}

export async function synchronizeJsrManifest(
  manifestPath: string,
  expectedName: string,
  version: string,
): Promise<boolean> {
  const file = await readJsrManifestFile(manifestPath);
  if (file === undefined) return false;
  const { manifest, source } = file;
  assertManifestName(manifest, expectedName, manifestPath);
  if (manifest.version === version) return false;

  await writeFile(
    manifestPath,
    replaceManifestVersion(source, manifest.version, version, manifestPath),
  );
  return true;
}

async function synchronizeDraftManifests(
  draft: Draft,
  packages: Array<{ id: string; name: string; path: string; version?: string }>,
): Promise<void> {
  await Promise.all(
    packages.map(async (pkg) => {
      if (
        pkg.version === undefined ||
        draft.getPackageDraft(pkg.id)?.type === undefined
      ) {
        return;
      }

      await synchronizeJsrManifest(
        join(pkg.path, "jsr.json"),
        pkg.name,
        pkg.version,
      );
    }),
  );
}

function publishablePackages(plan: PublishPlan) {
  return Array.from(plan.packages).filter(
    ([, packagePlan]) => packagePlan.preflight?.shouldPublish === true,
  );
}

function orderOf(name: string | undefined, order: readonly string[]): number {
  if (name === undefined) return order.length;
  const index = order.indexOf(name);
  return index === -1 ? order.length : index;
}

async function readJsrManifest(path: string): Promise<JsrManifest | undefined> {
  return (await readJsrManifestFile(path))?.manifest;
}

async function readJsrManifestFile(
  path: string,
): Promise<{ manifest: JsrManifest; source: string } | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  const parsed: unknown = JSON.parse(source);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    typeof parsed.name !== "string" ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`Invalid JSR manifest: ${path}`);
  }

  return { manifest: parsed as JsrManifest, source };
}

function replaceManifestVersion(
  source: string,
  currentVersion: string,
  value: string,
  path: string,
): string {
  const property = /"version"\s*:\s*/g;
  const match = property.exec(source);
  if (match === null || property.exec(source) !== null) {
    throw new Error(`Invalid version property in JSR manifest: ${path}`);
  }

  const valueStart = match.index + match[0].length;
  const serializedVersion = JSON.stringify(currentVersion);
  if (!source.startsWith(serializedVersion, valueStart)) {
    throw new Error(`Invalid version property in JSR manifest: ${path}`);
  }
  return `${source.slice(0, valueStart)}${JSON.stringify(value)}${source.slice(valueStart + serializedVersion.length)}`;
}

function assertManifestIdentity(
  manifest: JsrManifest,
  expectedName: string,
  expectedVersion: string,
  path: string,
): void {
  assertManifestName(manifest, expectedName, path);
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `JSR manifest ${path} is ${manifest.version}; expected ${expectedVersion}.`,
    );
  }
}

function assertManifestName(
  manifest: JsrManifest,
  expectedName: string,
  path: string,
): void {
  if (manifest.name !== expectedName) {
    throw new Error(
      `JSR manifest ${path} names ${manifest.name}; expected ${expectedName}.`,
    );
  }
}

async function isJsrVersionPublished(
  name: string,
  version: string,
  fetchRegistry: typeof fetch,
): Promise<boolean> {
  const match = /^@([^/]+)\/(.+)$/.exec(name);
  if (match === null)
    throw new Error(`Invalid scoped JSR package name: ${name}`);

  const url = `https://jsr.io/@${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/${encodeURIComponent(version)}_meta.json`;
  const response = await fetchRegistry(url, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `Unable to check ${name}@${version} on JSR: ${response.status} ${response.statusText}`,
    );
  }
  return true;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed${signal === null ? ` with exit code ${code}` : ` from signal ${signal}`}.`,
        ),
      );
    });
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
