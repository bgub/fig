# Templates

Status: exploring (experimental, opt-in via `figTemplates()`)

Compiler-extracted static JSX rendered as cloned instances instead of
per-element fibers. A template element renders one host instance for a whole
static subtree — mount is a prototype clone plus slot binding, update is a
slot-array diff — which is why template-shaped trees mount and update
2–4× faster than their fiber-per-element equivalents.

## The Descriptor

`template(html, slots, segments?)` in `@bgub/fig` creates a descriptor: pure,
renderer-agnostic data carrying two projections of one structure, marked with
`Symbol.for("fig.template")` so renderers recognize it in element-type
position (`createElement(descriptor, { key?, slots })`).

- `html` + `slots` — the client projection. The DOM renderer parses `html`
  once per descriptor into a `<template>` prototype and clones it per
  instance. Each slot spec addresses a dynamic position by child-index
  `path` from the root:
  - `text` — path resolves to a placeholder Text node; the slot value
    becomes its data (`null`/`undefined` render as `""`).
  - `attr` — path resolves to an Element; the value routes through the
    normal attribute/property policy (single-prop `updateElement`).
  - `events` — path resolves to an Element; the value is the standard
    `events={[on(...)]}` array. Dispatch is per-DOM-element, so positional
    slot identity, abort-on-change, delegation, and the
    attach/detach-on-insertion lifecycle apply unchanged inside template
    interiors — a delegated event bubbles from template content into
    ancestor fiber handlers with no special casing.
- `segments` — the server projection: static HTML strings interleaved with
  slot indexes. The server streams strings verbatim and slot values with
  kind-appropriate escaping (text vs attribute); `events` slots render
  nothing. Descriptors without `segments` cannot server-render.

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

A template consumes exactly one hydratable element and the cursor never
descends into it — its interior came from the same descriptor's server
segments. Validation mirrors host hydration policy:

- structural failures (wrong root tag, unresolvable slot path, wrong node
  type at a slot) and **text-slot value mismatches** are hydration
  mismatches — the root client-renders via `onRecoverableError`;
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
- a dynamic `{expression}` child must be its element's only child (adjacent
  text nodes merge when HTML parses, which would shift paths) **and**
  provably textual — a template/string/number literal or a `+` expression
  (always a primitive). Identifiers, calls, and member expressions bail:
  a text slot stringifies, and those could evaluate to elements;
- `key` on the root only (it forwards to the element props);
- at least two elements (a lone element gains nothing over
  `createElement`).

Eligible subtrees nested inside ineligible parents (rows inside a `.map`
callback) still compile.

## Open

- `bind` inside templates (a slot kind reusing the bind lifecycle).
- Mixed static/dynamic text (needs marker nodes or comment anchors to keep
  paths stable — the common `v{version}` pattern currently bails).
- Real-browser benchmark of the full pipeline (in-memory numbers:
  mount 2.2–2.8×, slot updates 3.0–4.2×, reorders 2.2×).
- Whether `figTemplates()` graduates into the default fig-vite setup once
  eligibility is broad enough that bailing is rare.
