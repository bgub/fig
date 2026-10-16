import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packagePath = resolve("packages/fig-tanstack-start");
const compilerPath = resolve("node_modules/typescript/bin/tsc");

void test("built Start entries preserve required and optional request context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fig-start-entry-types-"));
  try {
    await symlink(
      join(packagePath, "node_modules"),
      join(directory, "node_modules"),
    );
    const imports = `
      import { createFigStartHandler, createServerEntry } from ${JSON.stringify(join(packagePath, "dist/server.js"))};
      import defaultEntry from ${JSON.stringify(join(packagePath, "dist/default-entry/server.js"))};
      import type { RequestHandler } from '@tanstack/start-server-core';
      import type { Register } from '@tanstack/router-core';
    `;
    const required = `
      ${imports}
      declare module '@tanstack/router-core' {
        interface Register {
          server: { requestContext: { tenantId: string } };
        }
      }
      const fetch: RequestHandler<Register> = (_request, opts) =>
        new Response(opts.context.tenantId);
      const entry = createServerEntry({ fetch });
      const handler = createFigStartHandler();
      const request = new Request('https://example.test/');
      const options = { context: { tenantId: 'tenant' } };
      entry.fetch(request, options);
      handler(request, options);
      defaultEntry.fetch(request, options);
      // @ts-expect-error Required context cannot be omitted.
      entry.fetch(request);
      // @ts-expect-error Required context cannot be omitted.
      handler(request);
      // @ts-expect-error Required context cannot be omitted.
      defaultEntry.fetch(request);
      // @ts-expect-error The registered tenant id is required.
      entry.fetch(request, { context: {} });
    `;
    const optional = `
      ${imports}
      const fetch: RequestHandler<Register> = () => new Response('ok');
      const entry = createServerEntry({ fetch });
      const handler = createFigStartHandler();
      const request = new Request('https://example.test/');
      entry.fetch(request);
      handler(request);
      defaultEntry.fetch(request);
    `;

    for (const [name, source] of Object.entries({ required, optional })) {
      const file = join(directory, `${name}.ts`);
      await writeFile(file, source);
      await execFileAsync(process.execPath, [
        compilerPath,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "preserve",
        "--moduleResolution",
        "bundler",
        "--target",
        "esnext",
        file,
      ]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
