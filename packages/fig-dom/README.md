# @bgub/fig-dom

Fig DOM renderer.

## Installation

```bash
pnpm add @bgub/fig-dom
```

## Usage

```ts
import { createPortal, createRoot, hydrateRoot } from "@bgub/fig-dom";
```

`hydrateRoot(container, node)` reuses server HTML, attaches Fig DOM
bindings/events, and reports recoverable mismatches through
`onRecoverableError`. Components that read external stores with
`useExternalStore` use their server snapshot during hydration, then subscribe
and reconcile to the current client snapshot after commit.

Suspense hydration is boundary-based: server Suspense markers stay
dehydrated after the shell hydrates, then hydrate in background work or
synchronously when an interaction lands inside that boundary. Pending
boundaries stay dehydrated until the server completes them, while
server-recovered boundaries schedule client rendering for that boundary.

`createPortal(children, container, key?)` renders children into an existing DOM
container while keeping context, effects, and delegated events attached to the
logical Fig tree.

## DOM Compatibility

Fig DOM treats ordinary host props as attributes instead of maintaining a large
React-style property table. Native HTML/SVG attribute names such as `class`,
`for`, `tabindex`, `readonly`, `maxlength`, `viewBox`, `stroke-width`,
`xlink:href`, `aria-*`, and `data-*` pass through directly. Object `style`
props support camel-cased CSS properties and CSS custom properties such as
`--accent`.

SVG and MathML elements are created in their own namespaces, and
`foreignObject` children return to the HTML namespace. Hydration compares
against Fig's native attribute names so browser-normalized server attributes
such as `tabindex`, `readonly`, and `xlink:href` do not look like extras.

Use `unsafeHTML="<p>trusted html</p>"` to write raw `innerHTML`. Fig does not
sanitize this string, so only pass trusted or sanitized markup. `unsafeHTML`
manages the element contents directly and cannot be combined with children.

Fig intentionally does not implement React's resource and metadata behavior for
`title`, `meta`, `link`, `script`, or `style`. It also does not warn for
`contentEditable`; native DOM behavior applies.

## License

MIT
