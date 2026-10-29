/// <reference types="node" />
// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createComposite } from "./composite.ts";

it("registers production items without full-list scans and reads current DOM order on demand", () => {
  // Compile a separate production module graph; the normal Vitest config
  // replaces __FIG_DEV__ with true. Bundling also supports Node versions
  // without native TypeScript loading.
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { Window } from "happy-dom";
    import { build } from "vite";
    const [bundle] = await build({
      configFile: false,
      logLevel: "silent",
      define: { __FIG_DEV__: "false" },
      build: {
        write: false,
        lib: { entry: ${JSON.stringify(resolve(import.meta.dirname, "composite.ts"))}, formats: ["es"] },
      },
    });
    const { createComposite } = await import("data:text/javascript;base64," + Buffer.from(bundle.output[0].code).toString("base64"));
    const { document } = new Window();
    const owner = document.createElement("div");
    owner.setAttribute("role", "listbox");
    document.body.append(owner);
    const nodes = Array.from({ length: 100 }, (_, value) => {
      const node = document.createElement("div");
      node.setAttribute("role", "option");
      owner.append(node);
      return node;
    });
    let scans = 0;
    const query = owner.querySelectorAll.bind(owner);
    owner.querySelectorAll = (...args) => { scans += 1; return query(...args); };
    let changes = 0;
    const composite = createComposite({
      name: "test", container: '[role="listbox"]', item: '[role="option"]',
      registrationChanged: () => { changes += 1; },
    });
    const controllers = nodes.map(() => new AbortController());
    composite.bindContainer(owner, new AbortController().signal);
    nodes.forEach((node, value) => composite.bindItem(node, controllers[value].signal, value, false));
    const registrationScans = scans;
    owner.prepend(nodes[99]);
    const reordered = composite.items().map(({ value }) => value);
    controllers[99].abort();
    const remaining = composite.items().map(({ value }) => value);
    console.log(JSON.stringify({ registrationScans, scans, changes, reordered, remaining }));
  `,
    ],
    { encoding: "utf8" },
  );
  const observed = JSON.parse(result) as {
    registrationScans: number;
    scans: number;
    changes: number;
    reordered: number[];
    remaining: number[];
  };
  expect(observed.registrationScans).toBe(0);
  expect(observed.scans).toBe(2);
  expect(observed.changes).toBe(102);
  expect(observed.reordered).toEqual([
    99,
    ...Array.from({ length: 99 }, (_, index) => index),
  ]);
  expect(observed.remaining).toEqual(
    Array.from({ length: 99 }, (_, index) => index),
  );
});

it("still diagnoses duplicate values eagerly in development", () => {
  const owner = document.createElement("div");
  owner.setAttribute("role", "listbox");
  const first = document.createElement("div");
  const second = document.createElement("div");
  first.setAttribute("role", "option");
  second.setAttribute("role", "option");
  owner.append(first, second);
  const composite = createComposite({
    name: "test",
    container: '[role="listbox"]',
    item: '[role="option"]',
  });
  composite.bindContainer(owner, new AbortController().signal);
  composite.bindItem(first, new AbortController().signal, "same", false);
  expect(() =>
    composite.bindItem(second, new AbortController().signal, "same", false),
  ).toThrow(/must be unique/);
});
