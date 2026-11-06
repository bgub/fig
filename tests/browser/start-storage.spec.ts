import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { workspacePath } from "../../scripts/lib/fig-source-aliases.ts";

test("Start storage bundles and runs in a classic service worker without code rewriting", async ({
  page,
}) => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: {
        "node:async_hooks": workspacePath(
          "tests/browser/fixtures/start-storage/async-hooks.ts",
        ),
      },
    },
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: workspacePath("tests/browser/fixtures/start-storage/worker.ts"),
        formats: ["iife"],
        name: "startWorker",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing worker bundle");
  const server: Server = createServer((request, response) => {
    response.setHeader(
      "Content-Type",
      request.url === "/sw.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/sw.js"
        ? chunk.code
        : "<!doctype html><title>Start worker</title>",
    );
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          ),
        );
    });
    expect(
      await page.evaluate(() =>
        Promise.all(
          ["first", "second"].map(async (id) =>
            (await fetch(`/?id=${id}`)).json(),
          ),
        ),
      ),
    ).toEqual([{ id: "first" }, { id: "second" }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
