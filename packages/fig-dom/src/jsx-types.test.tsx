import type { FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { on } from "./index.ts";

// Type-level tests for the stage-1 JSX host-prop types: vp check enforces
// every @ts-expect-error below (an unused one is itself an error), so this
// file pins what the types reject and what they infer. The runtime test is
// deliberately trivial — nothing here renders.

function expectNode(node: FigNode): FigNode {
  return node;
}

function typeChecks(): FigNode[] {
  return [
    // Fig props typecheck, and bind infers the per-tag element type.
    expectNode(
      <input
        class="field"
        tabindex={0}
        bind={(node, signal) => {
          const input: HTMLInputElement = node;
          const abort: AbortSignal = signal;
          void input;
          void abort;
        }}
        events={[on("input", (event, signal) => void [event, signal])]}
      />,
    ),
    expectNode(<label for="field">Name</label>),
    expectNode(<input maxlength={20} readonly />),
    expectNode(
      <img alt="Preview" src="/preview.png" srcset="/preview.png 1x" />,
    ),
    expectNode(<div style={{ color: "red", "--gap": "4px" }} />),
    expectNode(<div unsafeHTML="<b>trusted</b>" />),
    expectNode(<time suppressHydrationWarning>{Date.now()}</time>),
    expectNode(
      <circle bind={(node) => void (node satisfies SVGCircleElement)} />,
    ),
    expectNode(<path stroke-width="2" />),
    expectNode(<use xlink:href="#icon" />),
    expectNode(<div data-testid="x" aria-hidden="true" role="button" />),
    expectNode(
      <my-widget
        class="custom"
        data-id="x"
        bind={(node) => {
          const element: HTMLElement = node;
          void element;
        }}
      />,
    ),
    // Custom elements (dashed names) get the baseline HTMLElement contract.
    expectNode(
      <my-widget
        class="x"
        bind={(node) => void (node satisfies HTMLElement)}
      />,
    ),
    // Conditional entries are part of the events contract.
    expectNode(
      <button
        events={[false, null, undefined, on("click", () => undefined)]}
      />,
    ),

    // Form-state props are Fig policy: value/checked control the live DOM
    // state, defaultValue/defaultChecked own the HTML representation.
    expectNode(<input defaultValue="draft" />),
    expectNode(<input defaultChecked />),
    expectNode(<input type="checkbox" checked={true} defaultChecked={false} />),
    expectNode(<input value="controlled" defaultValue="initial" />),
    expectNode(<input value={42} />),
    expectNode(<textarea value="controlled" />),
    expectNode(<textarea defaultValue="draft" rows={4} />),
    expectNode(<select value="b" />),
    expectNode(<select defaultValue="b" />),
    expectNode(<select multiple value={["a", "b"]} />),
    expectNode(<select value={2} defaultValue={1} />),
    // Form-state props accept Fig's empty values like any other prop.
    expectNode(<input checked={undefined} value={null} defaultValue={false} />),

    // React-habit props are rejected.
    // @ts-expect-error className is not a Fig prop — use class.
    expectNode(<div className="x" />),
    // @ts-expect-error htmlFor is not a Fig prop — use for.
    expectNode(<label htmlFor="x" />),
    // @ts-expect-error ref does not exist — use bind.
    expectNode(<div ref={() => undefined} />),
    // @ts-expect-error dangerouslySetInnerHTML does not exist — use unsafeHTML.
    expectNode(<div dangerouslySetInnerHTML={{ __html: "x" }} />),
    // @ts-expect-error listener props do not exist — use events={[on(...)]}.
    expectNode(<button onClick={() => undefined} />),
    // @ts-expect-error listener props are rejected on custom elements too.
    expectNode(<my-widget onClick={() => undefined} />),
    // @ts-expect-error native inline-handler attributes are rejected too.
    expectNode(<button onclick="alert(1)" />),
    // @ts-expect-error unknown non-custom element names are still rejected.
    expectNode(<widget />),
    // @ts-expect-error unknown native attributes are rejected.
    expectNode(<div clas="x" />),
    // @ts-expect-error native attribute values are scalar, not Fig nodes.
    expectNode(<div title={<span>Wrong shape</span>} />),
    // @ts-expect-error SVG attributes use native names, not React aliases.
    expectNode(<path strokeWidth="2" />),
    // @ts-expect-error arbitrary object values are not host attributes.
    expectNode(<button type={{ kind: "button" }} />),
    // @ts-expect-error checked is a boolean, not the string attribute form.
    expectNode(<input checked="checked" />),
    // @ts-expect-error defaultChecked is a boolean.
    expectNode(<input defaultChecked="true" />),
    // @ts-expect-error form-state props exist only on form controls.
    expectNode(<div defaultValue="x" />),
    // @ts-expect-error only select values may be arrays.
    expectNode(<input value={["a"]} />),

    // Fig props are shape-checked.
    // @ts-expect-error events takes an array of on() descriptors, not a handler.
    expectNode(<button events={() => undefined} />),
    // @ts-expect-error events entries must be descriptors (or falsy), not handlers.
    expectNode(<button events={[() => undefined]} />),
    // @ts-expect-error style is an object, not a string.
    expectNode(<div style="color: red" />),
    // @ts-expect-error numeric style values are dropped at runtime — use strings.
    expectNode(<div style={{ width: 100 }} />),
    // @ts-expect-error unsafeHTML is a plain string.
    expectNode(<div unsafeHTML={{ __html: "x" }} />),
    // @ts-expect-error bind receives (node, signal), not a ref object.
    expectNode(<div bind={{ current: null }} />),
  ];
}

describe("@bgub/fig-dom JSX types", () => {
  it("compiles the type-level expectations", () => {
    expect(typeof typeChecks).toBe("function");
  });
});
