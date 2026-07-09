// Experimental (bet-2 template project): compiler-emitted template
// descriptors. A template element (`createElement(descriptor, { slots })`)
// renders as one host instance cloned from static structure plus per-render
// slot values — no per-element fibers. The descriptor is renderer-agnostic
// data with two projections of the same structure:
//   html + slots — the client form: parsed once into a <template> prototype,
//     cloned per instance; slot paths address dynamic nodes by child index.
//   segments — the server form: static HTML strings interleaved with slot
//     indexes, streamed with kind-appropriate escaping (event slots render
//     nothing on the server).
// Compiler contract: single root element, no whitespace-only text nodes,
// placeholder text at every text-slot path, segment slot indexes in
// document order.

export type TemplateSlotSpec =
  | { readonly kind: "text"; readonly path: readonly number[] }
  | {
      readonly kind: "attr";
      readonly name: string;
      readonly path: readonly number[];
      // The server projection needs the owning tag so it can route the
      // value through the same host-prop serializer as ordinary JSX. The
      // client resolves the element from path and does not otherwise use it.
      readonly tag: string;
    }
  | { readonly kind: "events"; readonly path: readonly number[] };

export type TemplateSegment = string | number;

export interface TemplateDescriptor {
  readonly html: string;
  readonly rootTag: string;
  readonly slots: readonly TemplateSlotSpec[];
  readonly segments?: readonly TemplateSegment[];
}

const TemplateSymbol = Symbol.for("fig.template");

export function template(
  html: string,
  slots: readonly TemplateSlotSpec[] = [],
  segments?: readonly TemplateSegment[],
): TemplateDescriptor {
  const rootTag = /^<([A-Za-z][\w-]*)/.exec(html)?.[1]?.toLowerCase() ?? "";
  const descriptor = { html, rootTag, segments, slots };
  (descriptor as unknown as Record<symbol, boolean>)[TemplateSymbol] = true;
  return descriptor;
}

export function isTemplateDescriptor(
  value: unknown,
): value is TemplateDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TemplateSymbol] === true
  );
}
