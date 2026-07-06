import { spawn } from "node:child_process";

export function createTaskGroup() {
  const running = new Set();
  let shuttingDown = false;

  return {
    get shuttingDown() {
      return shuttingDown;
    },
    run(label, command, args, logger) {
      return new Promise((resolve, reject) => {
        const task = this.startProcess(label, command, args, logger);
        task.onExit((code, signal) => {
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
    },
    startProcess(label, command, args, logger, options = {}) {
      const lineListeners = new Set();
      const child = spawn(command, args, {
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const onLine = (line) => {
        options.onLine?.(line);
        for (const listener of lineListeners) listener(line);
      };

      logger.pipe(label, child.stdout, process.stdout, onLine);
      logger.pipe(label, child.stderr, process.stderr, onLine);

      return track(running, {
        onLine(listener) {
          lineListeners.add(listener);
        },
        onExit(listener) {
          child.on("exit", listener);
        },
        stop(signal) {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill(signal);
          }
        },
      });
    },
    track(task) {
      return track(running, task);
    },
    stop(signal) {
      shuttingDown = true;
      for (const task of running) task.stop(signal);
    },
  };
}

function track(running, task) {
  running.add(task);
  task.onExit(() => running.delete(task));
  return task;
}
