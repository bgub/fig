#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createLogger, portlessUrlFor } from "./dev/logging.mjs";
import { startStaticServer } from "./dev/static-server.mjs";
import { createTaskGroup } from "./dev/tasks.mjs";

const mode = process.argv[2];

if (mode !== "node" && mode !== "static") {
  console.error("Usage: node ../dev-server.mjs node|static");
  process.exit(1);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageName = packageJson.name;
if (typeof packageName !== "string") {
  throw new Error("Expected package.json to have a name.");
}

const logger = createLogger({ portlessUrl: portlessUrlFor(packageJson) });
const tasks = createTaskGroup();

process.on("SIGINT", () => stopAndExit("SIGINT"));
process.on("SIGTERM", () => stopAndExit("SIGTERM"));

await tasks.run("setup", "vp", [
  "run",
  "--filter",
  `${packageName}...`,
  "build",
], logger);

const running = [
  tasks.startProcess("build", "vp", ["pack", "--watch"], logger),
  mode === "node"
    ? tasks.startProcess(
        "server",
        process.execPath,
        ["--watch", "--watch-preserve-output", "dist/server.js"],
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
