# JSX Types

Status: stable (stage 1); stage 2 exploring

How JSX is typed, and who owns the host-prop vocabulary.

## Namespace Placement

`@bgub/fig/jsx-runtime` exports the `JSX` namespace TypeScript resolves under
`jsxImportSource: "@bgub/fig"`: `Element = FigNode` (components may return
strings, numbers, null, arrays), `ElementChildrenAttribute`,
`IntrinsicAttributes { key }`, and a deliberately **empty**
`IntrinsicElements`. The runtime module's value exports are exactly the
transform contract: `jsx`/`jsxs`/`jsxDEV`/`Fragment` (`jsxDEV` aliases `jsx`;
dev-transform extra arguments are ignored — Fig builds component stacks from
fibers).

Host-prop vocabulary belongs to renderers: `@bgub/fig-dom` fills
`IntrinsicElements` via module augmentation (global once any fig-dom import
is in the program). A compilation with no renderer types in scope rejects
intrinsic tags.

## Stage 1: `HostProps<E>`

One generic interface per tag, mapped from TypeScript's own
`HTML/SVG/MathMLElementTagNameMap`s (overlapping tags take the HTML typing;
dashed names get the custom-element arm at the `HTMLElement` baseline):

- Fig's props are enforced precisely: `bind?: Bind<E>` (so `bind` infers the
  concrete element type per tag — no `forwardRef` gymnastics), `events` as an
  `on()`-descriptor array, string-valued `style` objects (numeric values are
  compile errors, matching the runtime's no-px-suffix stance), `unsafeHTML`,
  `key`, `children`. Empty-prop typing mirrors the runtime's one emptiness
  rule via `EmptyPropValue = false | null | undefined`.
- React-habit props are rejected with `never` traps: `className`, `htmlFor`,
  `ref`, `dangerouslySetInnerHTML`, and the whole `on*` family via a
  template-literal index signature (which also rejects native inline-handler
  attributes).
- Everything else is an open, natively-named attribute index (`class`,
  `for`, `tabindex`, `aria-*`, `data-*`, `stroke-width`, `xlink:href`).

The contract is pinned by a type-level test
(`fig-dom/src/jsx-types.test.tsx`) whose `@ts-expect-error` markers are
enforced by typecheck — a regression that stops rejecting `className` fails
the build.

## Stage 2 (Exploring): Closed Attribute Vocabulary

Replace the open attribute index with a closed vocabulary from an
**externally-maintained attribute package** (decision: do not hand-curate)
for typo protection — which also removes the union-typed index, so
`title={<div/>}` stops passing. Learned from a hand-curated prototype: a
first-cut list misses real attributes immediately (`lang`, `charset`,
`open`, `colspan`, `srcset`, ...), and SVG/MathML-only tags likely keep an
open index (their vocabulary is huge and camelCase-heavy — `viewBox`, `cx`,
`preserveAspectRatio` — matching no pattern). Whatever package is chosen must
use native attribute names, not React's.
