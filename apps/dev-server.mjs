#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

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

const children = new Set();
let shuttingDown = false;

process.on("SIGINT", () => stopAndExit("SIGINT"));
process.on("SIGTERM", () => stopAndExit("SIGTERM"));

await run("vp", ["run", "--filter", `${packageName}...`, "build"]);

const devProcesses = [
  start("vp", ["pack", "--watch"]),
  mode === "node"
    ? start(process.execPath, ["--watch", "dist/server.js"])
    : start("python3", [
        "-m",
        "http.server",
        process.env.PORT ?? "4173",
        "--bind",
        "127.0.0.1",
      ]),
];

for (const child of devProcesses) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    stopChildren(signal === null ? "SIGTERM" : signal);
    process.exit(code ?? 1);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with ${signal ?? code}.`,
        ),
      );
    });
  });
}

function start(command, args) {
  const child = spawn(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  children.add(child);
  child.on("exit", () => children.delete(child));

  return child;
}

function stopAndExit(signal) {
  stopChildren(signal);
  process.exit(0);
}

function stopChildren(signal) {
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}
