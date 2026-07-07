#!/usr/bin/env node
import { startViteDevServer } from "./dev-server.ts";

const [command = "dev", ...args] = process.argv.slice(2);

if (command !== "dev") {
  usage();
  process.exit(1);
}

const port = numberOption(args, "--port") ?? Number(process.env.PORT ?? 3000);

void startViteDevServer({
  clientEntry: stringOption(args, "--client-entry"),
  port,
  publicUrl: stringOption(args, "--public-url"),
  root: stringOption(args, "--root"),
  tailwind: booleanOption(args, "--tailwind"),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

function stringOption(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function numberOption(
  args: readonly string[],
  name: string,
): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanOption(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function usage(): void {
  console.error(
    "Usage: fig-start dev [--root <dir>] [--port <port>] [--public-url <url>] [--tailwind]",
  );
}
