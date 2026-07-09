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
    expect(code).toMatch(
      /kind: "attr",\s*name: "data-id",\s*tag: "li",\s*path: \[\]/,
    );
    expect(code).toMatch(/kind: "text",\s*path: \[0, 0\]/);
    expect(code).toMatch(/kind: "events",\s*path: \[1\]/);
    // Server segments carry the dynamic attribute with its slot index.
    expect(code).toMatch(/\["<li class=\\"row\\"", 0, ">/);
    // The JSX collapsed into one element call carrying slot values.
    expect(code).toMatch(
      /_figElement\(_figTmpl, \{\s*slots: \[id, "Row " \+ label, \[onGo\]\]\s*\}\)/,
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
    expect(code).toMatch(/\{_figElement\(_figTmpl/);
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

  it("bails on form, foreign, raw-text, and parser-context subtrees", async () => {
    for (const source of [
      'const a = <div><textarea value="x" /></div>;',
      "const b = <table><tbody><tr><td><span>x</span></td></tr></tbody></table>;",
      "const c = <svg><g><path /></g></svg>;",
      "const d = <iframe><span>x</span></iframe>;",
      "const e = <div><pre>{`\\ncode`}</pre></div>;",
    ]) {
      expect(await transformTemplates(source, "/app/x.tsx")).toBeNull();
    }
  });

  it("routes bare attributes through slots and bails on special props", async () => {
    const code = await transform(
      "const x = <button disabled><span>ready</span></button>;",
    );
    expect(code).toMatch(
      /kind: "attr",\s*name: "disabled",\s*tag: "button",\s*path: \[\]/,
    );
    expect(code).toContain("slots: [true]");
    expect(code).not.toContain("<button disabled");

    for (const source of [
      'const a = <div style="color:red"><span>x</span></div>;',
      'const b = <div onClick="go()"><span>x</span></div>;',
      "const c = <div suppressHydrationWarning><span>x</span></div>;",
    ]) {
      expect(await transformTemplates(source, "/app/x.tsx")).toBeNull();
    }
  });

  it("generates collision-free helper and descriptor identifiers", async () => {
    const code = await transform(
      `const _figTemplate = 1;
       const _figElement = 2;
       const _figTmpl = 3;
       export const x = <div><span>a</span><span>b</span></div>;`,
    );

    expect(code).toContain("template as _figTemplate2");
    expect(code).toContain("createElement as _figElement2");
    expect(code).toContain("const _figTmpl2 = _figTemplate2");
  });

  it("bails when moving key evaluation before an earlier dynamic prop", async () => {
    expect(
      await transformTemplates(
        "const x = <li data-id={read()} key={key()}><span>x</span></li>;",
        "/app/x.tsx",
      ),
    ).toBeNull();
  });

  it("merges adjacent static JSX text when calculating slot paths", async () => {
    const code = await transform(
      `const x = (
        <div>
          <span>a{/* compile-only comment */}b<strong>{\`v\${version}\`}</strong></span>
          <em>x</em>
        </div>
      );`,
    );

    expect(code).toMatch(/kind: "text",\s*path: \[0, 1, 0\]/);
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
    expect(code).toContain("_figTmpl");
    expect(code).toContain("key: row.id");
    expect(code).toContain("<ul class=");
  });
});
