#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createLogger, portlessUrlFor } from "./dev/logging.mjs";
import { startStaticServer } from "./dev/static-server.mjs";
import { createTaskGroup } from "./dev/tasks.mjs";

const mode = process.argv[2];

if (mode !== "node" && mode !== "start" && mode !== "static") {
  console.error("Usage: node ../dev-server.mjs node|start|static");
  process.exit(1);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageName = packageJson.name;
if (typeof packageName !== "string") {
  throw new Error("Expected package.json to have a name.");
}

const logger = createLogger({ portlessUrl: portlessUrlFor(packageJson) });
const tasks = createTaskGroup();
const skipSetup = process.env.FIG_DEV_SERVER_SKIP_SETUP === "1";

process.on("SIGINT", () => stopAndExit("SIGINT"));
process.on("SIGTERM", () => stopAndExit("SIGTERM"));

if (!skipSetup) {
  await tasks.run(
    "setup",
    "vp",
    ["run", "--filter", `${packageName}...`, "build"],
    logger,
  );
}

const build = tasks.startProcess(
  "build",
  "vp",
  ["pack", "--watch", "--no-clean"],
  logger,
);
if (skipSetup) await waitForInitialBuild(build);

const running = [
  build,
  mode === "node" || mode === "start"
    ? tasks.startProcess(
        "server",
        process.execPath,
        [
          "--watch",
          "--watch-preserve-output",
          mode === "start" ? "dist/dev-server.js" : "dist/server.js",
        ],
        logger,
      )
    : tasks.track(
        startStaticServer({
          logger,
          port: process.env.PORT,
          publicUrl: portlessUrlFor(packageJson),
          root: process.cwd(),
        }),
      ),
];

for (const task of running) {
  task.onExit((code, signal) => {
    if (tasks.shuttingDown) return;

    tasks.stop(signal === null ? "SIGTERM" : signal);
    process.exit(code ?? 1);
  });
}

function stopAndExit(signal) {
  tasks.stop(signal);
  process.exit(0);
}

function waitForInitialBuild(task) {
  return new Promise((resolve, reject) => {
    task.onLine((line) => {
      if (/\b(?:Build complete|Rebuilt)\b/.test(line)) resolve();
    });
    task.onExit((code, signal) => {
      reject(new Error(`Initial app build exited early: ${signal ?? code}.`));
    });
  });
}
