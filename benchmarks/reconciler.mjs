#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runBenchmarkSuite } from "./lib/runner.mjs";
import { clientScenariosForRows } from "./scenarios/client.mjs";
import { hydrationScenariosForRows } from "./scenarios/hydration.mjs";
import { payloadScenariosForRows } from "./scenarios/payload.mjs";
import { serverScenariosForRows } from "./scenarios/server.mjs";

function scenariosForRows(rows) {
  return [
    ...clientScenariosForRows(rows),
    ...hydrationScenariosForRows(rows),
    ...payloadScenariosForRows(rows),
    ...serverScenariosForRows(rows),
  ];
}

export async function main(argv) {
  await runBenchmarkSuite(argv, scenariosForRows);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
