import { runCli } from "tegami/cli";
import { createFigRelease } from "./release/config.mts";

await runCli(createFigRelease());
