import { describe, expect, it } from "vite-plus/test";
import { transformTemplates } from "./templates.ts";

async function transform(code: string): Promise<string | null> {
  const result = await transformTemplates(code, "/app/row.tsx");
  return result?.code ?? null;
}

describe("fig:templates transform", () => {
  it("compiles an eligible subtree into a hoisted descriptor", async () => {
    const code = await transform(
      `export function Row({ id, label, onGo }) {
        return (
          <li class="row" data-id={id}>
            <span>{"Row " + label}</span>
            <button events={[onGo]}>Go</button>
          </li>
        );
      }`,
    );

    expect(code).not.toBeNull();
    expect(code).toContain(
      'import { template as _figTemplate, createElement as _figElement } from "@bgub/fig"',
    );
    // Client html: static structure, placeholder text at the slot, dynamic
    // attribute omitted.
    expect(code).toContain(
      '_figTemplate("<li class=\\"row\\"><span> </span><button>Go</button></li>"',
    );
    // Slots in document order: root attr, span text, button events.
    expect(code).toMatch(/kind: "attr",\s*name: "data-id",\s*path: \[\]/);
    expect(code).toMatch(/kind: "text",\s*path: \[0, 0\]/);
    expect(code).toMatch(/kind: "events",\s*path: \[1\]/);
    // Server segments carry the dynamic attribute with its slot index.
    expect(code).toContain('" data-id=\\""');
    // The JSX collapsed into one element call carrying slot values.
    expect(code).toMatch(
      /_figElement\(_figTmpl\$0, \{\s*slots: \[id, "Row " \+ label, \[onGo\]\]\s*\}\)/,
    );
  });

  it("forwards a root key to the element props", async () => {
    const code = await transform(
      `export const item = (id) => (
        <li key={id} class="row"><span>fixed</span><span>also</span></li>
      );`,
    );

    expect(code).toContain("key: id");
    expect(code).toContain("slots: []");
  });

  it("bails on component children, spreads, bind, and mixed dynamic text", async () => {
    for (const source of [
      "const a = <li><Item /></li>;",
      "const b = <li {...rest}><span>x</span></li>;",
      "const c = <li bind={fn}><span>x</span></li>;",
      "const d = <li><span>v{version}</span><span>x</span></li>;",
      // Identifier/member/call expressions are not provably textual: a text
      // slot stringifies, and these could evaluate to elements.
      "const e = <li><span>{label}</span><span>x</span></li>;",
      "const f = <div><h3>t</h3><ul>{rows.map(renderRow)}</ul></div>;",
    ]) {
      expect(await transformTemplates(source, "/app/x.tsx")).toBeNull();
    }
  });

  it("wraps templates that replace JSX children in expression containers", async () => {
    const code = await transform(
      `export const page = (
        <main>
          <Header />
          <section class="rows">
            <span>first</span>
            <span>second</span>
          </section>
        </main>
      );`,
    );

    // <main> bails (component child); <section> compiles and must remain a
    // valid JSX child of the surviving <main> JSX.
    expect(code).not.toBeNull();
    expect(code).toMatch(/\{_figElement\(_figTmpl\$0/);
  });

  it("bails on document-shell and hoisted-asset tags", async () => {
    for (const source of [
      'const a = <head><meta charset="utf-8" /><title>x</title></head>;',
      'const b = <div><span>x</span><script src="/x.js"></script></div>;',
      'const c = <div><link rel="stylesheet" href="/x.css" /><span>x</span></div>;',
    ]) {
      expect(await transformTemplates(source, "/app/x.tsx")).toBeNull();
    }
  });

  it("bails on single-element trees where cloning gains nothing", async () => {
    expect(
      await transformTemplates("const a = <li>static</li>;", "/app/x.tsx"),
    ).toBeNull();
  });

  it("still compiles eligible subtrees nested inside ineligible parents", async () => {
    const code = await transform(
      `export function List({ rows }) {
        return (
          <ul class="list">
            {rows.map((row) => (
              <li key={row.id} class="row">
                <span>{\`Row \${row.id}\`}</span>
                <span>fixed</span>
              </li>
            ))}
          </ul>
        );
      }`,
    );

    // The <ul> bails (expression child alongside nothing else is fine, but
    // its child is a map callback, not a static element); the row template
    // inside the callback still compiles.
    expect(code).not.toBeNull();
    expect(code).toContain("_figTmpl$0");
    expect(code).toContain("key: row.id");
    expect(code).toContain("<ul class=");
  });
});
