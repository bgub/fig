# JSX Types

Status: stable

How JSX is typed, and who owns the host-prop vocabulary.

## Namespace Placement

JSX uses the renderer as its import source. DOM projects configure `jsxImportSource: "@bgub/fig-dom"`; that package's `jsx-runtime` and `jsx-dev-runtime` entrypoints expose the core transform values alongside a DOM-owned `JSX` namespace. `Element = FigNode` (components may return strings, numbers, null, arrays, or promises of nodes), `ElementChildrenAttribute`, `IntrinsicAttributes { key }`, and `IntrinsicElements` are therefore available without global or module augmentation. The runtime value exports are exactly the transform contract: `jsx`/`jsxs`/`jsxDEV`/`Fragment` (`jsxDEV` aliases `jsx`; dev-transform extra arguments are ignored — Fig builds component stacks from fibers). The broad return type serves server and decoded Payload components too; direct async client components are unsupported, so client code uses a synchronous component that memoizes and returns a promise child.

`@bgub/fig/jsx-runtime` remains renderer-neutral and deliberately has an empty `IntrinsicElements`. Custom renderers provide their own JSX runtime entrypoints; a compilation using core directly as its import source rejects intrinsic tags.

## `HostProps<E, AttributeName>`

One generic host-prop type per tag, mapped from TypeScript's own `HTML/SVG/MathMLElementTagNameMap`s (overlapping tags take the HTML typing; dashed names get the custom-element arm at the `HTMLElement` baseline):

- Fig's props are enforced precisely: `bind?: Bind<E>` (so `bind` infers the concrete element type per tag — no `forwardRef` gymnastics), `mix?: MixinInput` for host behavior descriptors, string-valued `style` objects (numeric values are compile errors, matching the runtime's no-px-suffix stance), `unsafeHTML`, `key`, `children`. Empty-prop typing mirrors the runtime's one emptiness rule via `EmptyPropValue = false | null | undefined`.
- React-habit props are rejected with `never` traps: `className`, `htmlFor`, `ref`, `dangerouslySetInnerHTML`, and the whole `on*` family via a template-literal index signature (which also rejects native inline-handler attributes).
- Everything else on HTML/SVG tags is a closed, natively-named attribute vocabulary (`class`, `for`, `tabindex`, `aria-*`, `data-*`, `stroke-width`, `xlink:href`) with scalar values only (`string`, `number`, `true`, or Fig's empty values). This catches typos like `clas` and rejects non-attribute values like `title={<div />}`. MathML and custom elements deliberately keep an open attribute index because their useful vocabularies are app-defined or not well-covered by the external sources.

The contract is pinned by a type-level test (`packages/fig-dom/src/jsx-types.test.tsx`) whose `@ts-expect-error` markers are enforced by typecheck — a regression that stops rejecting `className`, host attribute typos, or object-valued native attributes fails the build.

## Attribute Vocabulary

The HTML/SVG attribute source is intentionally quarantined:

- `scripts/generate-jsx-attributes.mjs` reads `html-element-attributes` and `svg-element-attributes`.
- `packages/fig-dom/src/jsx-attributes.generated.ts` is a checked-in generated snapshot of literal tag/attribute unions. It exists because those packages publish widened `Record<string, string[]>` declarations, which TypeScript cannot use directly as literal JSX prop names.
- `packages/fig-dom/src/jsx-attribute-policy.ts` is the small handwritten policy layer: Fig props, React-habit traps, `aria-*`/`data-*`, `role`, legacy SVG namespace attributes, scalar attribute values, and the open MathML/custom-element escape hatches.

This is deliberately easy to replace. The generated file is not a runtime dependency and should not accumulate Fig policy.
