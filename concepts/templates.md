# Templates

Status: exploring (experimental, opt-in via `figTemplates()`)

Compiler-extracted static JSX rendered as cloned instances instead of
per-element fibers. A template element renders one host instance for a whole
static subtree — mount is a prototype clone plus slot binding, update is a
slot-array diff. In headless Chromium at 1,000 rows, compiled templates mount
1.43–1.47× faster and update 2.74–2.92× faster than the equivalent
fiber-per-element tree; keyed reversal is 1.10–1.11× faster.

## The Descriptor

`template(html, slots, segments?)` in `@bgub/fig` creates a descriptor: pure,
renderer-agnostic data carrying two projections of one structure, marked with
`Symbol.for("fig.template")` so renderers recognize it in element-type
position (`createElement(descriptor, { key?, slots })`). The descriptor's
`rootTag` is derived from `html` for host-ancestor validation.

- `html` + `slots` — the client projection. The DOM renderer parses `html`
  once per descriptor into a `<template>` prototype and clones it per
  instance. Each slot spec addresses a dynamic position by child-index
  `path` from the root:
  - `text` — path resolves to a placeholder Text node; the slot value
    becomes its data (`null`/`undefined` render as `""`).
  - `attr` — path resolves to an Element; `tag` records that element's host
    tag for the server projection. The value routes through the normal
    attribute/property policy on the client (single-prop `updateElement`) and
    server, so omission, boolean, style, validation, and thrown-value behavior
    do not form a second prop model.
  - `events` — path resolves to an Element; the value is the standard
    `events={[on(...)]}` array. Dispatch is per-DOM-element, so positional
    slot identity, abort-on-change, delegation, and the
    attach/detach-on-insertion lifecycle apply unchanged inside template
    interiors — a delegated event bubbles from template content into
    ancestor fiber handlers with no special casing.
- `segments` — the server projection: static HTML strings interleaved with
  slot indexes. The server streams strings verbatim, escapes text slots, and
  routes attribute slots through the ordinary host serializer; `events` slots
  render nothing. Descriptors without `segments` cannot server-render.

Compiler contract for `html`: a single root element, no whitespace-only text
nodes (paths index `childNodes` verbatim), placeholder text present at every
text-slot path, and no markup that a parser would restructure.

## Identity

Renderers key template sameness on **descriptor object identity**: the
reconciler's `sameType` compares `fiber.type === element.type`, and the DOM
renderer caches one `<template>` prototype per descriptor object. Two
consequences:

- The compiler hoists one descriptor per template site, module-scoped.
- The payload decoder canonicalizes descriptors by content into a
  client-global registry, so equal descriptors arriving in later payloads
  (boundary refreshes, navigations) decode to the same object and template
  fibers keep identity instead of remounting (see payload.md, the
  `$fig: "template"` model node).

## Reconciler Semantics

`TemplateTag` fibers are leaf hosts: no child fibers, one instance. Slot
arrays diff element-wise (`Object.is`); a change sets the host-update flags
and commits through the commit queue like any host update. Instances are
recreated until their first commit so a discarded render's slot values never
leak into the committed tree. Placement, keyed reorder, visibility
(hide/unhide as a host instance), deletion, and sibling-anchor resolution
treat templates exactly as hosts.

## Hydration

A template consumes exactly one hydratable element and the reconciler cursor
never descends into it. The DOM host builds the expected clone, applies
non-event slots, and compares its complete structure with the server DOM
before adoption. This catches deployment skew and parser/extension mutations
that a root-tag-only check would preserve forever because the interior has no
fibers.

- structural or static-skeleton failures and **text-slot value mismatches**
  are hydration mismatches — the root client-renders via
  `onRecoverableError`;
- **attribute-slot differences** are preserved with a dev warning (the
  server value is kept until the slot value changes);
- adoption resolves slot nodes for future updates and binds `events` slots
  (the server rendered nothing for them).

## Server Components

Descriptors cross the payload inline — they are pure data, so there is no
module registry (payload.md documents the wire node). Event-slot values are
functions and never serialize: templates with `events` slots belong in
client components, the same standing rule as any function prop.

## The Compiler

`figTemplates()` (`@bgub/fig-vite`, `enforce: "pre"`, before `figRefresh`)
compiles eligible JSX subtrees into hoisted descriptors. v0 eligibility —
every rule keeps slot paths stable or semantics identical to fiber
rendering; anything else bails to normal JSX:

- every element is a lowercase intrinsic; no components, fragments,
  spreads, namespaces, `bind`, or `unsafeHTML` anywhere in the subtree;
- document/asset tags, form controls, foreign-content roots, raw-text tags,
  and context-sensitive table markup bail. Descendants of those elements are
  also excluded, since an isolated HTML `<template>` would parse them in the
  wrong context or skip Fig's form semantics;
- special host props (`onX`, `suppressHydrationWarning`, string `style`) bail;
  bare attributes become ordinary attribute slots so client and server host
  policies stay authoritative;
- a dynamic `{expression}` child must be its element's only child (adjacent
  text nodes merge when HTML parses, which would shift paths) **and**
  provably textual — a template/string/number literal or a `+` expression
  (always a primitive). Identifiers, calls, and member expressions bail:
  a text slot stringifies, and those could evaluate to elements;
- `key` on the root only (it forwards to the element props); a dynamic prop
  before `key` bails rather than changing expression evaluation order;
- at least two elements (a lone element gains nothing over
  `createElement`).

Eligible subtrees nested inside ineligible parents (rows inside a `.map`
callback) still compile.

## Open

- `bind` inside templates (a slot kind reusing the bind lifecycle).
- Mixed static/dynamic text (needs marker nodes or comment anchors to keep
  paths stable — the common `v{version}` pattern currently bails).
- Whether `figTemplates()` graduates into the default fig-vite setup once
  eligibility is broad enough that bailing is rare.

The real-browser benchmark is environment-gated in the demo SSR Playwright
suite (`FIG_RUN_TEMPLATE_BENCHMARK=1`). It alternates compiled and ordinary
fiber samples against identical live DOM shapes; update/reorder samples run
ten operations each to reduce timer quantization.
