# JSX Types

Status: stable

The active renderer owns JSX's host-element vocabulary. Core knows what a Fig node is; Fig DOM knows which props an `<input>` or `<svg>` accepts.

## Choosing The JSX Runtime

DOM applications configure:

```json
{
  "compilerOptions": {
    "jsxImportSource": "@bgub/fig-dom"
  }
}
```

`@bgub/fig-dom/jsx-runtime` and `jsx-dev-runtime` expose the core transform functions plus a DOM-specific `JSX` namespace. This avoids global augmentation and lets another renderer provide a different set of intrinsic elements.

The renderer-neutral `@bgub/fig/jsx-runtime` deliberately has no intrinsic elements. Using it directly rejects tags such as `<div>`.

`JSX.Element` is `FigNode`, so components may return text, arrays, `null`, or promises of nodes. Direct async client components are still unsupported because their promise identity would change on retries. A client component should instead return a stable, memoized promise child.

The transform exports are only `jsx`, `jsxs`, `jsxDEV`, and `Fragment`. `jsxDEV` aliases `jsx`; Fig builds component stacks from fibers rather than transform metadata.

## Host Props

Each DOM tag maps to `HostProps<ElementType, AttributeNames>`. This gives Fig precise types for its own props:

- `bind` infers the concrete node type from the tag;
- `mix` accepts host mixin descriptors;
- `style` accepts string values, matching Fig's no-automatic-`px` runtime;
- `unsafeHTML`, `key`, and `children` keep their Fig shapes; and
- empty attributes accept `false`, `null`, or `undefined` consistently.

HTML and SVG use a closed, native attribute vocabulary. Write `class`, `for`, `tabindex`, `stroke-width`, and `xlink:href`. `aria-*` and `data-*` remain open. MathML and dashed custom elements also stay open because their useful attributes are application-defined or poorly covered by upstream sources.

React-only spellings are explicit type errors: `className`, `htmlFor`, `ref`, `dangerouslySetInnerHTML`, and every `on*` prop. This also rejects native inline-handler attributes. Other invalid values, such as `title={<div />}`, fail because native attributes accept only scalar values.

The type-level suite in `packages/fig-dom/src/jsx-types.test.tsx` pins these rules. If a change accidentally accepts `className`, a misspelled host prop, or an object-valued attribute, typechecking fails.

## Where Attribute Names Come From

The generated vocabulary is intentionally separate from Fig policy:

- `scripts/generate-jsx-attributes.mjs` reads `html-element-attributes` and `svg-element-attributes`.
- `packages/fig-dom/src/jsx-attributes.generated.ts` stores checked-in literal tag and attribute unions.
- `packages/fig-dom/src/jsx-attribute-policy.ts` adds Fig props, React-habit traps, scalar values, and the open MathML and custom-element cases.

The generated file is not a runtime dependency and should contain no Fig-specific decisions. That keeps the source replaceable if a better attribute dataset appears.
