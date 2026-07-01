export function createLogger(options = {}) {
  const portlessUrl = options.portlessUrl ?? null;

  return {
    line(label, line, output = process.stdout) {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) return;
      output.write(`[${label}] ${formatLine(label, trimmed, portlessUrl)}\n`);
    },
    pipe(label, stream, output = process.stdout) {
      pipeLines(label, stream, output, portlessUrl);
    },
  };
}

export function portlessUrlFor(pkg) {
  const name = pkg.portless?.name;
  return typeof name === "string" && name.length > 0
    ? `https://${name}.localhost/`
    : null;
}

function pipeLines(label, stream, output, portlessUrl) {
  if (stream === null) return;

  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += sanitizeOutput(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.length > 0) {
        output.write(`[${label}] ${formatLine(label, trimmed, portlessUrl)}\n`);
      }
    }
  });
  stream.on("end", () => {
    const trimmed = pending.trimEnd();
    if (trimmed.length > 0) {
      output.write(`[${label}] ${formatLine(label, trimmed, portlessUrl)}\n`);
    }
    pending = "";
  });
}

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_ERASE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[HJ]`, "g");
const ANSI_CURSOR_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ABCDG]`, "g");
const ANSI_RESET_PATTERN = new RegExp(`${ANSI_ESCAPE}c`, "g");

function sanitizeOutput(value) {
  return value
    .replace(ANSI_ERASE_PATTERN, "")
    .replace(ANSI_CURSOR_PATTERN, "")
    .replace(ANSI_RESET_PATTERN, "")
    .replace(/\r/g, "\n");
}

function formatLine(label, line, portlessUrl) {
  if (label !== "server" || portlessUrl === null) return line;

  const localUrl =
    line.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/)?.[0] ?? null;
  return localUrl === null ? line : line.replace(localUrl, portlessUrl);
}
